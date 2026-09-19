# Releases and updates

[README](../README.md) | [Contributing](../CONTRIBUTING.md) | [Deployment](DEPLOYMENT.md)

A stable Git tag in [swissmakers/swisspaste](https://github.com/swissmakers/swisspaste) identifies a release. The application checks those tags when a user selects **Check for updates** in the footer. A GitHub Release entry can provide release notes, but is not required by the checker.

## Version metadata

Keep the following values aligned before building a release:

| Location | Example | Purpose |
| --- | --- | --- |
| `VERSION` | `1.0.0` | Version embedded in the Go binary, footer and `/api/config`. |
| `package.json` | `1.0.0` | Browser package version. |
| `package-lock.json` | `1.0.0` | Root package metadata recorded by npm. |
| Git tag | `v1.0.0` | Published source revision used by the update checker. |

Use `major.minor.patch` with non-negative integer components and no leading zeros. Tags can have a leading `v`. The checker ignores prereleases, build metadata and unrelated tags. Comparison is numeric: `1.10.0` is newer than `1.9.0`.

## Prepare a release

**Prerequisites:** the build environment in [Contributing](../CONTRIBUTING.md#build-and-run-locally), the container validation environment in [Deployment](DEPLOYMENT.md#validate-a-candidate) and network access for dependency scans. Run commands from the repository root.

1. Set `VERSION` and the `version` field in `package.json` to the intended release version.
2. Update the lockfile metadata. This records the package version without changing the declared dependency versions.

   ```bash
   npm install --package-lock-only
   ```

3. Install dependencies from the updated lockfile.

   ```bash
   npm ci
   ```

4. Regenerate the editor bundle, dependency notices, background variants and application icons.

   ```bash
   npm run build
   ```

5. Complete the [source and dependency checks](../CONTRIBUTING.md#verification) and [candidate validation](DEPLOYMENT.md#validate-a-candidate). Each check must pass for the source that will be tagged.
6. Review the source changes, generated assets, dependency notices and [photograph credits](ASSETS.md#third-party-credits).
7. Prepare release notes that describe user-visible changes, configuration changes and known limitations.

Retain the validated image for deployment. Rebuild and revalidate if runtime source, dependencies or build inputs change after validation.

## Publish a release

**Prerequisites:** maintainer access, completed release validation and reviewed source changes. The commands below use `1.0.0`; substitute the intended version. `origin` must point to `swissmakers/swisspaste`.

Commit, tag and push operations are maintainer actions. Automation and coding assistants must not perform them without an explicit instruction for that action.

1. Commit and push the reviewed source through the maintainer workflow.
2. Create an annotated tag from a clean checkout of that revision. This command creates the local tag without publishing it.

   ```bash
   git tag -a v1.0.0 -m "swissPaste 1.0.0"
   ```

3. Publish the tag. It becomes visible to the application's update checker after any cached result expires.

   ```bash
   git push origin v1.0.0
   ```

4. Add release notes to a GitHub Release for the tag if you publish release notes on GitHub.
5. Deploy the retained image using the [deployment procedure](DEPLOYMENT.md) for the instance's service manager. Use systemd for a Quadlet-managed instance and Compose for a Compose-managed instance.
6. Verify that the deployed version, published tag and available source correspond to the release.

Container image publishing and automated release workflows are not configured. Publishing a tag does not build or deploy a container.

## Update check behavior

The server queries the public GitHub tags API only when requested by the interface. It selects the highest stable version, regardless of tag creation order. The result links to the tagged source. The check does not download or install application updates.

| Condition | Result |
| --- | --- |
| A stable tag is newer than the installed version | The footer shows the available version and source link. |
| No stable tag is newer | The footer reports the installed version as current. |
| No stable tags exist | The footer reports that no stable versions are published. |
| GitHub is unavailable, a rate limit is reached or a response is invalid | The footer reports that it could not check for updates. |
| A user repeats a check | The process reuses successful results for one hour and failed results for one minute. |
| The tag list cannot be read within the request limits | The check reports unavailable rather than comparing a partial list. |

Each lookup has an eight-second total deadline, a limit of ten pages of 100 tags and a 1 MiB response limit per page. Redirects are rejected. Requests do not contain session codes, shared content, browser headers, cookies or credentials. GitHub receives the server's network address.

## Before the first public release

| Area | Required action |
| --- | --- |
| Source and tags | Publish the reviewed source and stable release tag. |
| Assets | Verify the photograph source pages, permissions and credits. |
| Source link | Confirm that the application footer leads to the corresponding source for the deployed build. Update the source link if distributing a modified fork. |
| Host startup | Configure systemd startup if the installation must recover after a host reboot. |
| Network access | Configure HTTPS, access controls and log handling before exposing the service outside loopback. |
