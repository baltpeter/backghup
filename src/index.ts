import fs from 'fs-extra';
import { Octokit } from 'octokit';
import _ora, { oraPromise } from 'ora';
import { join } from 'path';

const token = process.env['GITHUB_TOKEN'];
if (!token)
    throw new Error(
        'You need to provide a personal access token for your GitHub account in the GITHUB_TOKEN environment variable. The token needs to have the `repo` and `read:org` scopes.'
    );

// By default, if there is an existing migration created in the last hour, we'll use that one instead of creating a new
// one.
const forceNewMigration = process.argv.includes('--force-new-migration');
const outDir =
    (process.argv.includes('--out-dir') && process.argv[process.argv.indexOf('--out-dir') + 1]) || 'archives';

const octokit = new Octokit({ auth: token, userAgent: 'baltpeter/backghup' });

type Subject = { type: 'user' } | { type: 'org'; org: string };

type UserOrOrgState = { id: number; downloaded: boolean; failed: boolean };

const pause = (ms: number) =>
    new Promise((res) => {
        setTimeout(res, ms);
    });

const ora = (options: Parameters<typeof _ora>[0]) =>
    _ora({
        // This is necessary to make Ctrl+C work, see: https://github.com/sindresorhus/ora/issues/156#issuecomment-776177428
        discardStdin: false,
        hideCursor: false,
        ...(typeof options === 'string' ? { text: options } : options),
    });

(async () => {
    const username = (await octokit.rest.users.getAuthenticated()).data.login;

    const subjectToString = (s: Subject) => `${s.type} "${s.type === 'org' ? s.org : username}"`;

    const getExistingMigrationOrCreateNew = async (subject: Subject): Promise<UserOrOrgState | undefined> => {
        const spinner = ora(`Starting migration for ${subjectToString(subject)}...`).start();

        try {
            const repos =
                subject.type === 'user'
                    ? await octokit.rest.repos.listForAuthenticatedUser({ affiliation: 'owner' })
                    : await octokit.rest.repos.listForOrg({ org: subject.org });
            const migrations =
                subject.type === 'user'
                    ? await octokit.rest.migrations.listForAuthenticatedUser()
                    : await octokit.rest.migrations.listForOrg({ org: subject.org });

            // Check if there is an existing migration from the last hour that contains all repos.
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const existingMigration = migrations.data.find(
                (migration) =>
                    new Date(migration.created_at) > oneHourAgo &&
                    (repos.data as { id: number }[]).every((repo) =>
                        migration.repositories.some((migrationRepo) => migrationRepo.id === repo.id)
                    )
            );

            if (!forceNewMigration && existingMigration) {
                spinner.succeed(
                    `Found existing migration for ${subjectToString(subject)} [#${existingMigration.id}, from: ${
                        existingMigration.created_at
                    }].`
                );
                return { id: existingMigration.id, downloaded: false, failed: false };
            }

            const migration =
                subject.type === 'user'
                    ? await octokit.rest.migrations.startForAuthenticatedUser({
                          repositories: repos.data.map((repo) => repo.full_name),
                      })
                    : await octokit.rest.migrations.startForOrg({
                          org: subject.org,
                          repositories: repos.data.map((repo) => repo.full_name),
                      });
            spinner.succeed(`Started migration for ${subjectToString(subject)} [#${migration.data.id}].`);
            return { id: migration.data.id, downloaded: false, failed: false };
        } catch (err) {
            spinner.fail(`Failed to start migration for ${subjectToString(subject)}.`);
            console.error(err);
            return undefined;
        }
    };

    const adminOrgs = (await octokit.rest.orgs.listMembershipsForAuthenticatedUser()).data.filter(
        (org) => org.role === 'admin'
    );
    const state = {
        user: await getExistingMigrationOrCreateNew({ type: 'user' }),
        orgs: await adminOrgs.reduce<Promise<Record<string, UserOrOrgState>>>(async (_acc, orgData) => {
            const acc = await _acc;
            const org = orgData.organization.login;
            const res = await getExistingMigrationOrCreateNew({ type: 'org', org });
            if (res) acc[org] = res;
            return acc;
        }, Promise.resolve({})),
    } as const;

    console.log();
    await fs.ensureDir(outDir);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const done = () =>
            Object.values([state.user, ...Object.values(state.orgs)]).every((s) => !s || s.downloaded || s.failed);
        if (done()) break;

        const tryToDownloadArchive = async (subject: Subject) => {
            const spinner = ora(`Checking migration status for ${subjectToString(subject)}...`).start();

            try {
                const migrationStatus =
                    subject.type === 'user'
                        ? await octokit.rest.migrations.getStatusForAuthenticatedUser({
                              migration_id: state.user!.id,
                          })
                        : await octokit.rest.migrations.getStatusForOrg({
                              migration_id: state.orgs[subject.org]!.id,
                              org: subject.org,
                          });

                const filename = `${migrationStatus.data.created_at.substring(0, 10)}_${
                    subject.type === 'user' ? username : subject.org
                }_${migrationStatus.data.id}.tar.gz`;

                if (await fs.pathExists(join(outDir, filename))) {
                    spinner.succeed(
                        `Archive already downloaded for ${subjectToString(subject)} [#${migrationStatus.data.id}].`
                    );

                    if (subject.type === 'user') state.user!.downloaded = true;
                    else state.orgs[subject.org]!.downloaded = true;
                    return;
                }

                if (migrationStatus.data.state === 'failed') {
                    spinner.fail(`Migration for ${subjectToString(subject)} [#${migrationStatus.data.id}] failed.`);

                    if (subject.type === 'user') state.user!.failed = true;
                    else state.orgs[subject.org]!.failed = true;
                    return;
                }

                if (migrationStatus.data.state === 'exported') {
                    spinner.stop().clear();

                    const archive = (
                        await oraPromise(
                            subject.type === 'user'
                                ? octokit.rest.migrations.getArchiveForAuthenticatedUser({
                                      migration_id: migrationStatus.data.id,
                                  })
                                : octokit.rest.migrations.downloadArchiveForOrg({
                                      migration_id: migrationStatus.data.id,
                                      org: subject.org,
                                  }),
                            {
                                text: `Downloading archive for ${subjectToString(subject)} [#${
                                    migrationStatus.data.id
                                }]...`,
                                successText: `Downloaded archive for ${subjectToString(subject)} [#${
                                    migrationStatus.data.id
                                }].`,
                                discardStdin: false,
                                hideCursor: false,
                            }
                        )
                    ).data as ArrayBuffer;
                    await fs.writeFile(join(outDir, filename), Buffer.from(archive));

                    if (subject.type === 'user') state.user!.downloaded = true;
                    else state.orgs[subject.org]!.downloaded = true;
                }

                spinner.stop();
            } catch (err) {
                spinner.fail(`Failed to check migration status or download archive for ${subjectToString(subject)}.`);
                console.error(err);
                if (subject.type === 'user') state.user!.failed = true;
                else state.orgs[subject.org]!.failed = true;
            }
        };

        if (state.user && !state.user.downloaded) await tryToDownloadArchive({ type: 'user' });
        for (const org of Object.keys(state.orgs)) {
            if (state.orgs[org] && !state.orgs[org]!.downloaded) await tryToDownloadArchive({ type: 'org', org });
        }

        if (!done()) {
            const spinner = ora('Waiting for migration(s) to finish...').start();
            await pause(10000);
            spinner.stop().clear();
        }
    }

    if (Object.values([state.user, ...Object.values(state.orgs)]).some((s) => s?.failed)) process.exit(1);
})();
