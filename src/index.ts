#!/usr/bin/env node
import decompress from 'decompress';
import fs from 'fs-extra';
import { Octokit } from 'octokit';
import _ora, { oraPromise } from 'ora';
import { join } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
    .options({
        'force-new-migration': {
            type: 'boolean',
            describe:
                'By default, if there is an existing migration created in the last hour, we’ll use that one instead of creating a new one. With this flag, you can force a new migration to always be created.',
            default: false,
        },
        'out-dir': {
            type: 'string',
            describe: 'Directory to store the archives in.',
            default: 'archives',
        },
        extract: {
            type: 'boolean',
            describe:
                'Extract the archives into a folder named after the user/organization after downloading them. This will overwrite/delete existing files from a previous run (it is mostly meant to be used in conjunction with an incremental backup software).\nBy default, the archives are deleted after extraction. You can disable that behaviour with the `--keep-archives` flag.',
            default: false,
        },
        'keep-archives': {
            type: 'boolean',
            describe:
                'If you use the `--extract` flag, the archive files are deleted by default after extraction. With this flag, you can disable that behaviour to keep the archives after extracting them.',
            default: false,
        },
        exclude: {
            type: 'string',
            array: true,
            describe:
                'A regex to filter out the user and/or specific organizations (can be specified multiple times). The regex has to match the full name of the user or organization, from start to end, to exclude it (it will be automatically enclosed in the ^ and $ anchors). It is case-insensitive.',
            default: [],
        },
        'exclude-repo': {
            type: 'string',
            array: true,
            describe:
                'A regex to filter out specific repositories (can be specified multiple times). This is run against the full repository name (e.g. `baltpeter/backghup`). The regex has to match the full name of the repository, from start to end, to exclude it (it will be automatically enclosed in the ^ and $ anchors). It is case-insensitive.',
            default: [],
        },
    })
    .example('$0', 'Back up all your repositories, including the ones in organizations you are an admin of.')
    .example('$0 --out-dir ~/gh-backups', 'Back up everything, and store the archives in `~/gh-backups`.')
    .example(
        '$0 --out-dir ~/gh-backups --extract',
        'Back up everything, and extract the downloaded archives into a subdirectory named after the user/organization in `~/gh-backups`. Afterwards, delete the archive files.'
    )
    .example(
        '$0 --extract --keep-archives',
        "Back up everything and extract the archives, but don't delete the archive files after extraction."
    )
    .example(
        '$0 --exclude baltpeter --exclude tweaselORG',
        'Back up everything, but exclude the `baltpeter` user and the `tweaselORG` organization.'
    )
    .example('$0 --exclude-repo baltpeter/backghup', 'Back up everything, except the `baltpeter/backghup` repository.')
    .example(
        '$0 --exclude "b.*" --exclude-repo "baltpeter/.*-config"',
        'Back up everything, except repositories from users/organzations starting with a `b`, and repositories from the `baltpeter` user that end with `-config`.'
    )
    .parseSync();

const token = process.env['GITHUB_TOKEN'];
if (!token)
    throw new Error(
        'You need to provide a personal access token for your GitHub account in the GITHUB_TOKEN environment variable. The token needs to have the `repo` and `admin:org` scopes.'
    );

const octokit = new Octokit({ auth: token, userAgent: 'baltpeter/backghup' });

type Subject = { type: 'user' } | { type: 'org'; org: string };

type UserOrOrgState = { id?: number; downloaded: boolean; failed: boolean };

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
    const matchAgainstArgvRegex = (regex: 'exclude' | 'exclude-repo', value: string) =>
        argv[regex].some((r) => new RegExp(`^${r}$`, 'i').test(value));

    const markFailed = (subject: Subject) => {
        if (subject.type === 'user') {
            if (state.user) state.user.failed = true;
        } else {
            const orgState = state.orgs[subject.org];
            if (orgState) orgState.failed = true;
        }
    };

    const getExistingMigrationOrCreateNew = async (subject: Subject): Promise<UserOrOrgState> => {
        const spinner = ora(`Starting migration for ${subjectToString(subject)}...`).start();

        try {
            const allRepos = (
                subject.type === 'user'
                    ? await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, { affiliation: 'owner' })
                    : await octokit.paginate(octokit.rest.repos.listForOrg, { org: subject.org })
            ) as { id: number; full_name: string }[];
            const repos = allRepos.filter((repo) => !matchAgainstArgvRegex('exclude-repo', repo.full_name));

            if (!argv.forceNewMigration) {
                const migrations =
                    subject.type === 'user'
                        ? await octokit.paginate(octokit.rest.migrations.listForAuthenticatedUser)
                        : await octokit.paginate(octokit.rest.migrations.listForOrg, { org: subject.org });

                // Check if there is an existing migration from the last hour that contains all repos.
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                const existingMigration = migrations.find(
                    (migration) =>
                        new Date(migration.created_at) > oneHourAgo &&
                        repos.every((repo) =>
                            migration.repositories.some((migrationRepo) => migrationRepo.id === repo.id)
                        )
                );

                if (existingMigration) {
                    spinner.succeed(
                        `Found existing migration for ${subjectToString(subject)} [#${existingMigration.id}, from: ${
                            existingMigration.created_at
                        }].`
                    );
                    return { id: existingMigration.id, downloaded: false, failed: false };
                }
            }

            const migration =
                subject.type === 'user'
                    ? await octokit.rest.migrations.startForAuthenticatedUser({
                          repositories: repos.map((repo) => repo.full_name),
                      })
                    : await octokit.rest.migrations.startForOrg({
                          org: subject.org,
                          repositories: repos.map((repo) => repo.full_name),
                      });
            spinner.succeed(`Started migration for ${subjectToString(subject)} [#${migration.data.id}].`);
            return { id: migration.data.id, downloaded: false, failed: false };
        } catch (err) {
            spinner.fail(`Failed to start migration for ${subjectToString(subject)}.`);
            console.error(err);
            return { downloaded: false, failed: true };
        }
    };

    const adminOrgs = (await octokit.paginate(octokit.rest.orgs.listMembershipsForAuthenticatedUser))
        .filter((org) => org.role === 'admin')
        .filter((org) => !matchAgainstArgvRegex('exclude', org.organization.login));
    const state = {
        user: matchAgainstArgvRegex('exclude', username)
            ? undefined
            : await getExistingMigrationOrCreateNew({ type: 'user' }),
        orgs: await adminOrgs.reduce<Promise<Record<string, UserOrOrgState>>>(async (_acc, orgData) => {
            const acc = await _acc;
            const org = orgData.organization.login;
            acc[org] = await getExistingMigrationOrCreateNew({ type: 'org', org });
            return acc;
        }, Promise.resolve({})),
    } as const;

    console.log();
    await fs.ensureDir(argv.outDir);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const done = () =>
            Object.values([state.user, ...Object.values(state.orgs)]).every((s) => !s || s.downloaded || s.failed);
        if (done()) break;

        const extractArchive = async (archivePath: string, subject: Subject) => {
            const spinner = ora(`Extracting archive for ${subjectToString(subject)}...`).start();

            try {
                const extractDir = join(argv.outDir, subject.type === 'user' ? username : subject.org);

                // Delete a potential previous extraction. We don't want files that are no longer in the migration to
                // stay around.
                await fs.remove(extractDir);

                await decompress(archivePath, extractDir);
                spinner.succeed(`Extracted archive for ${subjectToString(subject)}.`);

                if (!argv.keepArchives)
                    await fs.remove(archivePath).catch((err) => {
                        markFailed(subject);
                        console.error('Failed to delete archive after extraction: ', err);
                    });
            } catch (err) {
                spinner.fail(`Failed to extract archive for ${subjectToString(subject)}.`);
                console.error(err);
                markFailed(subject);
            }
        };

        const tryToDownloadArchive = async (subject: Subject) => {
            const spinner = ora(`Checking migration status for ${subjectToString(subject)}...`).start();
            const migrationId = subject.type === 'user' ? state.user!.id : state.orgs[subject.org]!.id;
            if (!migrationId) {
                spinner.fail(`Missing migration ID for ${subjectToString(subject)}.`);
                markFailed(subject);
                return;
            }

            try {
                const migrationStatus =
                    subject.type === 'user'
                        ? await octokit.rest.migrations.getStatusForAuthenticatedUser({
                              migration_id: migrationId,
                          })
                        : await octokit.rest.migrations.getStatusForOrg({
                              migration_id: migrationId,
                              org: subject.org,
                          });

                const filename = `${migrationStatus.data.created_at.substring(0, 10)}_${
                    subject.type === 'user' ? username : subject.org
                }_${migrationStatus.data.id}.tar.gz`;

                if (await fs.pathExists(join(argv.outDir, filename))) {
                    spinner.succeed(
                        `Archive already downloaded for ${subjectToString(subject)} [#${migrationStatus.data.id}].`
                    );

                    if (subject.type === 'user') state.user!.downloaded = true;
                    else state.orgs[subject.org]!.downloaded = true;

                    if (argv.extract) await extractArchive(join(argv.outDir, filename), subject);

                    return;
                }

                if (migrationStatus.data.state === 'failed') {
                    spinner.fail(`Migration for ${subjectToString(subject)} [#${migrationStatus.data.id}] failed.`);

                    markFailed(subject);
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
                    await fs.writeFile(join(argv.outDir, filename), Buffer.from(archive));

                    if (argv.extract) await extractArchive(join(argv.outDir, filename), subject);

                    if (subject.type === 'user') state.user!.downloaded = true;
                    else state.orgs[subject.org]!.downloaded = true;
                }

                spinner.stop();
            } catch (err) {
                spinner.fail(`Failed to check migration status or download archive for ${subjectToString(subject)}.`);
                console.error(err);
                markFailed(subject);
            }
        };

        if (state.user && !state.user.downloaded && !state.user.failed) await tryToDownloadArchive({ type: 'user' });
        for (const org of Object.keys(state.orgs)) {
            if (state.orgs[org] && !state.orgs[org]!.downloaded && !state.orgs[org]!.failed)
                await tryToDownloadArchive({ type: 'org', org });
        }

        if (!done()) {
            const spinner = ora('Waiting for migration(s) to finish...').start();
            await pause(10000);
            spinner.stop().clear();
        }
    }

    if (Object.values([state.user, ...Object.values(state.orgs)]).some((s) => s?.failed)) process.exitCode = 1;
})();
