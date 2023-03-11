# backghup – Backup GitHub data using migrations

> Tool for backing up all your data on GitHub using the migration API.

Backghup is a command-line tool that lets you export and download all your data stored on GitHub. It uses the [migration API](https://docs.github.com/en/rest/migrations) to create and retrieve migration archives that can contain the following data (see the [API documentation for a full list](https://docs.github.com/en/rest/migrations/users?apiVersion=2022-11-28#download-a-user-migration-archive)):

* Repositories
* Issues, including comments
* Pull requests, including comments
* Commit comments
* Attachments
* Milestones
* Project and releases

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
```

## License

This code is licensed under the MIT license, see the [`LICENSE`](LICENSE) file for details.

Issues and pull requests are welcome! Please be aware that by contributing, you agree for your work to be licensed under an MIT license.
