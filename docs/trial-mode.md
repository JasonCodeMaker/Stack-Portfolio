# Trial mode

Trial mode starts the installed Stock Portfolio with its own data directory, so a release candidate can be tried on a copy of the real ledger without opening the real ledger.

| Launch | Data directory |
| --- | --- |
| Normal (Start menu, desktop shortcut) | `%APPDATA%\Stack Portfolio` |
| Trial (`--trial`) | `%APPDATA%\Stack Portfolio Trial` |

Everything the app stores follows the data directory: ledgers, the local ledger key, preferences, caches, diagnostics and the single-instance lock. A trial window and a normal window can therefore be open at the same time.

A trial window shows an amber frame with a **TRIAL** label at the top of every screen, and its title bar reads `Stock Portfolio — TRIAL`. A window without both is a normal window on the real ledger.

## Start a trial

Run the installed program with the `--trial` argument. With the default per-user install location:

```powershell
& "$env:LOCALAPPDATA\Programs\Stock Portfolio\Stock Portfolio.exe" --trial
```

If the app was installed elsewhere, use that folder's `Stock Portfolio.exe`. A shortcut whose target ends in ` --trial` works as well.

The argument must be exactly `--trial`. The Start menu and desktop shortcuts created by the installer start a normal launch.

## Seed the trial with a copy of the real ledger

1. In a **normal** window, on the version already in use, open **Settings → Ledger → Back up ledger**, set a backup password, and save the `.spbackup` file outside both data directories (for example in Documents). Close the normal window.
2. Install the release candidate. Do not start it from the Start menu until the trial has passed: that would open the real ledger with the candidate.
3. Start a trial with the command above. On the first trial launch there is no ledger, so the welcome page appears.
4. Choose **Restore from backup**, select the `.spbackup` file, enter the backup password, and confirm. The backup is copied into `%APPDATA%\Stack Portfolio Trial\portfolio.sqlite` and re-encrypted with the trial directory's own key. The `.spbackup` file is only read.

If the trial directory already holds a ledger, use **Settings → Ledger → Restore backup** instead; it replaces the trial ledger.

Broker credentials stored in the backup stay usable in the trial on the same Windows account, so a sync in the trial contacts the real broker. It writes only to the trial ledger.

## Start over

Close the trial window, then delete the trial directory:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\Stack Portfolio Trial"
```

**Settings → Ledger → Factory reset** inside a trial window does the same and restarts in trial mode. It does not touch `%APPDATA%\Stack Portfolio`.

## Limits

- Trial mode separates data, not program files. Installing a candidate replaces the installed program, so normal launches also run the candidate from then on.
- File pickers are unrestricted. Do not select files inside `%APPDATA%\Stack Portfolio` from a trial window.

## For developers

`desktop/launchProfile.cjs` resolves the data directory from the command line; `desktop/main.cjs` applies it before any storage, preference, diagnostics or single-instance call. The switch is a plain argument because the packaged app disables `NODE_OPTIONS` and `runAsNode`. `app.relaunch()` keeps the argument.

- `desktop/tests/launch-profile.test.cjs` runs in `npm --prefix desktop test`.
- `node desktop/tests/trial-mode.cjs [app.exe]` drives a normal and a trial window side by side; pass the installed executable to check a release candidate.
