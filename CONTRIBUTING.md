# Contributing

Contributions are welcome. For anything larger than a small fix, open an issue
first so the approach can be agreed before you write the code.

## Signed commits

Every commit in a pull request must be signed and show as **Verified** on
GitHub. A pull request containing an unsigned commit cannot be merged.

Signing with an SSH key you already use for GitHub is the quickest setup:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add the same key to GitHub as a **signing key** (Settings → SSH and GPG
keys → New SSH key → Key type: Signing Key). GPG keys work too; see GitHub's
guide to [signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

If you already pushed unsigned commits, re-sign them and force-push your
branch:

```bash
git rebase --exec 'git commit --amend --no-edit -S' main
git push --force-with-lease
```

## Before you open a pull request

- Run the tests for each half you changed: `npm test` at the root for the
  scanner, and `npm test` in `dashboard/` for the board. The dashboard's
  integration tests need a Postgres database in `DATABASE_URL`, otherwise
  they are skipped.
- If you changed anything under `scripts/benchmark`, run `npm run build` and
  commit the updated `dist/`. CI fails when the two differ.

Pull requests need an approving review and merge through a merge queue once
the checks pass.

## Licence

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
