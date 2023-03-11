# backghup – Back up GitHub data using migrations

> Tool for backing up all your data on GitHub using the migration API.

Backghup is a command-line tool that lets you export and download all your data stored on GitHub. It uses the [migration API](https://docs.github.com/en/rest/migrations) to create and retrieve migration archives that can contain the following data (see the [API documentation for a full list](https://docs.github.com/en/rest/migrations/users?apiVersion=2022-11-28#download-a-user-migration-archive)):

* Repositories
* Issues, including comments
* Pull requests, including comments
* Commit comments
* Attachments
* Milestones
* Projects and releases

![Colorful illustration of a camera on a tripod pointing at a cloud in the sky](https://static.bn.al/img/backghup-hero.jpg)

Backghup will download archives for your user account, as well as all organizations that you are an admin of (this is a limitation of the API). All repositories for the user or organization will be included in the archive.

You can run backghup multiple times and it will detect existing migrations and archives less than an hour old (can be disabled, see below) and not request and/or download them again.

## Installation and usage

You can install backghup globally using yarn or npm:

```sh
yarn global add backghup
# or `npm install -g backghup`
```

Alternatively, you can run it directly with npx:

```sh
npx backghup [options]
```

To use backghup, you need to [create an access token](https://github.com/settings/tokens) with the `repo` and `read:org` scopes.

Then, set the `GITHUB_TOKEN` environment variable to this access token:

```sh
export GITHUB_TOKEN=your-token-here
```

Finally, run backghup to create a new migration and download the archives:

```sh
backghup
```

This will download the archives for your user and organizations as `.tar.gz` files to the `archives` folder. You can change the output folder with the `--out-dir` option.

By default, backghup will check if there is an existing migration less than an hour old and if so, use that instead of creating a new one. You can force backghup to always create new migrations with the `--force-new-migration` flag.

You can also use the `--exclude` option to filter out specific users and organizations from being backed up, and the `--exclude-repo` option to filter out specific repositories from being backed up. These options take regular expressions as arguments and can be specified multiple times. The regular expressions have to match the full name of the user, organization (e.g. `baltpeter`) or repository (e.g. `baltpeter/backghup`), from start to end, to exclude it. They are case-insensitive. For example:

* To exclude your own user account and any organization that ends with a number, you can use:

  ```sh
  backghup --exclude <your username> --exclude ".*[0-9]"
  ```
* To exclude any repository from your user account that starts with `js-` and the repository `baltpeter/backghup`, you can use:

  ```sh
  backghup --exclude-repo "<your username>/js-.+" --exclude-repo baltpeter/backghup
  ```

Use `backghup --help` to show the help:

```
Options:
  --help                 Show help                                     [boolean]
  --version              Show version number                           [boolean]
  --force-new-migration  By default, if there is an existing migration created
                         in the last hour, we’ll use that one instead of
                         creating a new one. With this flag, you can force a new
                         migration to always be created.
                                                      [boolean] [default: false]
  --out-dir              Directory to store the archives in.
                                                  [string] [default: "archives"]
  --exclude              A regex to filter out the user and/or specific
                         organizations (can be specified multiple times). The
                         regex has to match the full name of the user or
                         organization, from start to end, to exclude it (it will
                         be automatically enclosed in the ^ and $ anchors). It
                         is case-insensitive.              [array] [default: []]
  --exclude-repo         A regex to filter out specific repositories (can be
                         specified multiple times). This is run against the full
                         repository name (e.g. `baltpeter/backghup`). The regex
                         has to match the full name of the repository, from
                         start to end, to exclude it (it will be automatically
                         enclosed in the ^ and $ anchors). It is
                         case-insensitive.                 [array] [default: []]

Examples:
  backghup                                  Back up all your repositories,
                                            including the ones in organizations
                                            you are an admin of.
  backghup --out-dir ~/backups              Back up all your repositories, and
                                            store the archives in `~/backups`.
  backghup --exclude baltpeter --exclude    Back up everything, but exclude the
  tweaselORG                                `baltpeter` user and the
                                            `tweaselORG` organization.
  backghup --exclude-repo                   Back up everything, except the
  baltpeter/backghup                        `baltpeter/backghup` repository.
  backghup --exclude "b.*" --exclude-repo   Back up everything, except
  "baltpeter/.*-config"                     repositories from users/
                                            organzations starting with a `b`,
                                            and repositories from the 
                                            `baltpeter` user that end with
                                            `-config`.
```

## License

This code is licensed under the MIT license, see the [`LICENSE`](LICENSE) file for details.

Issues and pull requests are welcome! Please be aware that by contributing, you agree for your work to be licensed under an MIT license.
