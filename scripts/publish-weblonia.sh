#!/usr/bin/env bash
# Publish the complete, verified AvaloniaWeb 0.6.2 source archive to Weblonia.
# Bash 3.2+ (macOS) / Linux; Git 2.29+; Python 3.9+.
# v1.2: HTTP/1.1 + bounded POST buffering, remote-ref reconciliation, safe resume.
# Preserves v1.1's TAP/spec parser fix. No force push or history rewrite.
set -Eeuo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
export GIT_NO_REPLACE_OBJECTS=1
umask 077

REPO='wieslawsoltes/Weblonia'
BRANCH='main'
ZIP=''
WORK=''
RESUME=''
SESSION=''
YES=0
DRY_RUN=0
PAGES=1
WAIT=1
BROWSER_TEST=0
PUSHED=0
PUSH_ATTEMPTED=0
PAGES_TOUCHED=0
TRANSPORT='https'
SELECTED_TAG=''
EXPECTED_SHA256='c73e921588ede76fedc79a9bdce1d03116d07eea0f2dbbcb484b137731f52303'

usage() {
    cat <<'HELP'
Usage:
  bash publish-weblonia-fixed-v2.sh SOURCE.zip [options]
  bash publish-weblonia-fixed-v2.sh --resume WORKSPACE [options]

  --resume PATH       Continue a retained, already-COMMITTED publisher workspace.
                      No ZIP required; no cleanup, build, tests, amend, or new commit.
  --transport MODE    https (default), ssh, or ssh-443. SSH needs existing key access
                      and normal host-key verification. Never configures SSH keys.
  --backup-tag NAME   Resolve an ambiguous legacy backup tag when resuming.
  --yes              Confirm remote publication without prompting.
  --dry-run          Fresh: extract, patch, build, test and stage. Resume: verify
                      committed bytes/evidence only. Neither mode accesses GitHub.
  --no-pages         Fresh: install a manual-only Pages workflow, skip Pages setup.
                      Resume: skip setup/wait; existing committed push triggers
                      are NOT modified and may still run automatically.
  --no-wait          Return after verified push; do not wait for Pages deployment.
  --browser-test     Also run local HTTP smoke tests (fresh publication only).
  --work-dir PATH    Use a NEW, nonexistent workspace (fresh publication only).
  --repo OWNER/NAME  Destination (default: wieslawsoltes/Weblonia).
  --branch NAME      Existing DEFAULT branch (default: main).
  -h, --help         Show help.

Requirements: Git >=2.29 and Python >=3.9; fresh builds need Node >=22 and npm.
Authenticated gh is needed for a real publication, including Pages setup over SSH.
Only the SHA-256-pinned original 0.6.2-alpha.1 ZIP is accepted for fresh builds.

Fresh cleanup affects only the temporary clone; the original checkout/ZIP are safe.
Resume verifies the original history bundle, exact commit parent, original source
inventory, current manifest, all committed file bytes, clean index/working tree,
and saved build/test evidence. It reuses the same commit AND backup tag.

HTTPS uses command-scoped HTTP/1.1 and a 64 MiB POST buffer for this upload's
HTTP-400/disconnect problem. No global Git settings or TLS checks are changed.
The branch and backup tag are read back after EVERY push, even a failed push.
At most three push attempts; no retry overwrites changed remote refs.
All workspaces and logs are retained. No --force, --mirror, reset, or rebase.
HELP
}
log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }
while [ "$#" -gt 0 ]; do
    case "$1" in
        --yes) YES=1 ;;
        --dry-run) DRY_RUN=1 ;;
        --no-pages) PAGES=0 ;;
        --no-wait) WAIT=0 ;;
        --browser-test) BROWSER_TEST=1 ;;
        --work-dir|--repo|--branch|--resume|--transport|--backup-tag)
            [ "$#" -ge 2 ] || die "$1 requires a value."
            [ -n "$2" ] || die "$1 requires a nonempty value."
            case "$1" in
                --work-dir) WORK=$2 ;; --repo) REPO=$2 ;; --branch) BRANCH=$2 ;;
                --resume) RESUME=$2 ;; --transport) TRANSPORT=$2 ;; --backup-tag) SELECTED_TAG=$2 ;;
            esac
            shift ;;
        -h|--help) usage; exit 0 ;;
        --) shift; [ "$#" -eq 1 ] && [ -z "$ZIP" ] || die 'Expected exactly one ZIP path.'; ZIP=$1; break ;;
        -*) die "Unknown option: $1" ;;
        *) [ -z "$ZIP" ] || die 'Expected exactly one ZIP path.'; ZIP=$1 ;;
    esac
    shift
done
case "$TRANSPORT" in https|ssh|ssh-443) ;; *) die '--transport must be https, ssh, or ssh-443.' ;; esac
if [ -n "$RESUME" ]; then
    [ -z "$ZIP" ] && [ -z "$WORK" ] && [ "$BROWSER_TEST" -eq 0 ] \
        || die '--resume cannot be combined with a ZIP, --work-dir, or --browser-test.'
else
    [ -n "$ZIP" ] || { usage; exit 2; }
    [ -z "$SELECTED_TAG" ] || die '--backup-tag is for --resume only.'
fi
for tool in git python3; do need "$tool"; done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' || die 'Python 3.9 or later is required.'
python3 - <<'PY'
import re, subprocess
m = re.search(r'\b(\d+)\.(\d+)', subprocess.check_output(['git', '--version'], text=True))
if not m or tuple(map(int, m.groups())) < (2, 29):
    raise SystemExit('Git 2.29 or later is required.')
PY
[[ "$REPO" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$ ]] || die 'Repository must be OWNER/NAME on github.com.'
[[ "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9_./-]*$ ]] || die 'Unsupported branch name.'
git check-ref-format "refs/heads/$BRANCH" >/dev/null || die 'Invalid branch name.'
SELF=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve(strict=True))' "${BASH_SOURCE[0]}")
if [ -n "$RESUME" ]; then
    WORK=$(python3 - "$RESUME" <<'PY'
from pathlib import Path
import os, sys
w = Path(sys.argv[1]).expanduser().resolve(strict=True)
m = w / '.publisher-workspace'
if (not w.is_dir() or w.stat().st_uid != os.getuid() or m.is_symlink()
        or not m.is_file() or m.read_text().strip() != 'weblonia-publisher-v1'):
    raise SystemExit('Not an owned, retained Weblonia publisher workspace.')
for p in (w / 'repo', w / 'repo/.git'):
    if not p.is_dir() or p.is_symlink():
        raise SystemExit('Resume requires the original private repo/.git directory.')
print(w)
PY
)
else
    for tool in node npm; do need "$tool"; done
    node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' || die 'Node.js 22 or later is required.'
    ZIP=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).expanduser().resolve(strict=True))' "$ZIP")
    [ -f "$ZIP" ] || die 'The ZIP is not a regular file.'
    if [ -n "$WORK" ]; then
        WORK=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).expanduser().absolute())' "$WORK")
        mkdir -- "$WORK" || die '--work-dir must not exist, and its parent must exist.'
    else
        WORK=$(mktemp -d "${TMPDIR:-/tmp}/weblonia-publish.XXXXXXXX")
    fi
    WORK=$(cd "$WORK" && pwd -P)
    printf 'weblonia-publisher-v1\n' > "$WORK/.publisher-workspace"
fi
REPO_DIR="$WORK/repo"
# An exclusive lock prevents two v1.2 publishers from sharing mutable checkpoints.
mkdir "$WORK/.publisher-v2.lock" 2>/dev/null \
    || die "Workspace is already locked. Stop its active publisher before removing a stale $WORK/.publisher-v2.lock directory."
on_exit() {
    status=$?
    trap - EXIT
    rmdir "$WORK/.publisher-v2.lock" 2>/dev/null || true
    if [ "$status" -ne 0 ]; then
        printf '\nStopped (exit %s). Workspace retained: %s\n' "$status" "$WORK" >&2
        if [ "$PUSHED" -eq 1 ]; then
            printf 'Remote source and backup tag were verified; Pages may still need attention.\n' >&2
        elif [ "$PUSH_ATTEMPTED" -eq 1 ] || [ -n "$RESUME" ]; then
            printf 'Remote publication is NOT verified. A disconnect can occur after the refs update.\nResume to check them; do not assume failure or success from Git progress text.\n' >&2
        else
            printf 'This invocation has not attempted a source push.\n' >&2
        fi
        [ "$PAGES_TOUCHED" -eq 0 ] || printf 'Pages configuration was attempted and may already have changed.\n' >&2
        printf 'Your original checkout and ZIP are untouched.\n' >&2
        if [ -n "$SESSION" ]; then printf 'Diagnostics: %s\n' "$SESSION" >&2; fi
        printf 'Resume after the local commit exists:\n  bash %q --resume %q --transport %q\n' "$SELF" "$WORK" "$TRANSPORT" >&2
    fi
    exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SESSION=$(mktemp -d "$WORK/.publisher-v2.XXXXXXXX")
log "Workspace: $WORK"
export GH_HOST=github.com GH_PAGER=cat GH_PROMPT_DISABLED=1
api() { gh api --hostname github.com -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2026-03-10' "$@"; }

cat > "$SESSION/recovery.py" <<'PUBLISH_RECOVERY_PY'
"""Publisher v1.2: verify a committed workspace and recover an ambiguous Git push.

This helper is embedded in publish-weblonia-fixed-v2.sh, not downloaded at runtime.
It never cleans, stages, resets, rebases, amends, or force-pushes a resumed tree.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

ARCHIVE_SHA = 'c73e921588ede76fedc79a9bdce1d03116d07eea0f2dbbcb484b137731f52303'
MANIFEST_SHA = '84d81246920a5660d6faab227640fdcecf0fc8aa8e75744606f38064d648937f'
OID_RE = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def write_json(path, value):
    require(not path.is_symlink(), 'Refusing to overwrite symlink: ' + str(path))
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def git(root, *args, timeout=90):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=timeout)


def text(root, *args):
    return git(root, *args).decode('utf-8').strip()


def regular(path):
    require(path.is_file() and not path.is_symlink(), 'Missing or unsafe file: ' + str(path))
    return path


def workspace(work):
    require(work.is_dir() and work.stat().st_uid == os.getuid(), 'Workspace must be owned by the current user')
    marker = regular(work / '.publisher-workspace')
    require(marker.read_text().strip() == 'weblonia-publisher-v1', 'Not a publisher workspace')
    root = work / 'repo'
    require(root.is_dir() and not root.is_symlink(), 'Expected a regular repo/ directory')
    require((root / '.git').is_dir() and not (root / '.git').is_symlink(), 'Expected the original private .git directory')
    require(Path(text(root, 'rev-parse', '--show-toplevel')).resolve() == root, 'Wrong Git working tree')
    require(Path(text(root, 'rev-parse', '--absolute-git-dir')).resolve() == root / '.git', 'Wrong Git directory')
    return root


def valid_relative(name):
    require(isinstance(name, str) and bool(name), 'Invalid manifest path')
    parts = name.split('/')
    require(not name.startswith('/') and '\\' not in name and ':' not in name
            and not any(p in ('', '.', '..', '.git') for p in parts)
            and not any(ord(c) < 32 for c in name), 'Unsafe manifest path: ' + name)
    return PurePosixPath(name)


def verify(work, repo, branch, requested_tag=''):
    """Validate HEAD against the exact manifest and recover v1.1's unrecorded tag."""
    root = workspace(work)
    recorded = read_json(regular(work / 'repository.json'))
    require(recorded.get('full_name', '').lower() == repo.lower(), 'Workspace belongs to a different repository')
    require(recorded.get('default_branch') == branch, 'Workspace belongs to a different default branch')
    require(text(root, 'symbolic-ref', '--short', 'HEAD') == branch, 'Resume refuses a different or detached branch')
    base = regular(work / 'base-commit.txt').read_text().strip()
    require(OID_RE.fullmatch(base), 'Invalid recorded base commit')
    require(text(root, 'cat-file', '-t', base) == 'commit', 'Base object is not a commit')
    commit = text(root, 'rev-parse', '--verify', 'HEAD')
    require(OID_RE.fullmatch(commit), 'Invalid publication commit')
    require(text(root, 'rev-list', '--parents', '-n', '1', commit).split() == [commit, base],
            'Expected exactly one publication commit directly after the recorded base. Do not amend or rebase this workspace; rerun from the ZIP.')
    for args in [('diff', '--no-ext-diff', '--quiet', '--'),
                 ('diff', '--no-ext-diff', '--cached', '--quiet', 'HEAD', '--')]:
        require(subprocess.run(['git', '-C', str(root), *args], check=False).returncode == 0,
                'Tracked workspace/index changes detected. Resume will not discard, stage, or commit them.')
    require(not git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
            'Untracked files detected. Resume will not add or delete them.')
    for name in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'):
        require(not (root / '.git' / name).exists(), 'Unfinished Git operation: ' + name)
    bundle = regular(work / 'remote-before-import.bundle')
    git(root, 'bundle', 'verify', str(bundle))
    bundled = {}
    for line in text(root, 'bundle', 'list-heads', str(bundle)).splitlines():
        oid, name = line.split(' ', 1)
        bundled[name] = oid
    require(bundled.get('refs/heads/' + branch) == base
            or bundled.get('refs/remotes/origin/' + branch) == base,
            'History bundle does not contain the recorded base branch')

    state_path = work / 'publication-state-v2.json'
    previous = read_json(regular(state_path)) if state_path.exists() else None
    if previous:
        require(previous.get('Schema') == 2 and previous.get('Repository') == repo
                and previous.get('Branch') == branch and previous.get('BaseCommit') == base
                and previous.get('Commit') == commit and previous.get('ArchiveSha256') == ARCHIVE_SHA,
                'Publication checkpoint disagrees with the local commit or destination')
        require(not requested_tag or previous['BackupTag'] == requested_tag, 'Backup tag disagrees with checkpoint')
        backup = previous['BackupTag']
    elif requested_tag:
        backup = requested_tag
    else:
        # v1.1 created the tag but did not save its name before the failed push.
        # Recover only tags absent from the pre-import bundle, pointing directly to base.
        candidates = []
        for line in text(root, 'for-each-ref', '--format=%(refname) %(objectname) %(objecttype)',
                         'refs/tags/backup/pre-weblonia-import-*').splitlines():
            name, oid, kind = line.split()
            if oid == base and kind == 'commit' and name not in bundled:
                candidates.append(name[len('refs/tags/'):])
        require(len(candidates) == 1,
                'Cannot uniquely recover the publication backup tag. Supply --backup-tag NAME from the failed run.')
        backup = candidates[0]
    require(isinstance(backup, str) and re.fullmatch(r'backup/pre-weblonia-import-[A-Za-z0-9-]+', backup),
            'Unexpected backup tag name')
    require(text(root, 'rev-parse', '--verify', 'refs/tags/' + backup) == base,
            'Backup tag no longer points directly to the original commit')

    manifest_path = regular(root / 'SOURCE-MANIFEST.json')
    manifest = read_json(manifest_path)
    original_path = regular(root / 'docs/publication/archive-0.6.2-alpha.1-manifest.json')
    require(hashlib.sha256(original_path.read_bytes()).hexdigest() == MANIFEST_SHA,
            'Archived original manifest changed')
    original = read_json(original_path)
    require(manifest.get('Version') == '0.6.2-alpha.1' and manifest.get('ManifestExcludesItself') is True,
            'Unexpected publication manifest')
    expected = {}
    for entry in manifest['Files']:
        name = entry['Path']
        valid_relative(name)
        require(name != 'SOURCE-MANIFEST.json' and name not in expected, 'Duplicate/recursive manifest entry')
        expected[name] = entry
    require({e['Path'] for e in original['Files']} <= set(expected), 'An original source file is missing')
    names = set(expected) | {'SOURCE-MANIFEST.json'}
    require('.github/workflows/pages.yml' in names and 'samples/ControlCatalog/threading-mode.js' in names,
            'Publication integration is missing')
    require(not any('.import' in name.split('/') for name in names)
            and '.github/workflows/import-source.yml' not in names, 'Abandoned importer fragments remain')
    staged = read_json(regular(work / 'staged-files.json'))
    require(len(staged) == len(names) and set(staged) == names, 'Saved staged inventory differs from manifest')
    entries = {}
    for record in git(root, 'ls-tree', '-r', '-z', commit).split(b'\0'):
        if not record:
            continue
        meta, raw_name = record.split(b'\t', 1)
        file_mode, kind, oid = meta.decode().split()
        name = raw_name.decode('utf-8')
        require(file_mode in ('100644', '100755') and kind == 'blob', 'Nonregular Git entry: ' + name)
        entries[name] = oid
    require(set(entries) == names, 'Committed tree differs from the validated inventory')
    algorithm = text(root, 'rev-parse', '--show-object-format')
    for name, oid in entries.items():
        path = root / valid_relative(name)
        require(path.resolve() == path, 'Symlink in committed file path: ' + name)
        data = regular(path).read_bytes()
        require(len(data) < 100 * 1024 * 1024, 'Oversized GitHub file: ' + name)
        require(path.suffix.lower() not in {'.ttf', '.otf', '.woff', '.woff2', '.ttc', '.otc', '.pfa', '.pfb'},
                'Font files must not be published: ' + name)
        require(hashlib.new(algorithm, b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == oid,
                'Committed bytes differ from the workspace: ' + name)
        if name in expected:
            entry = expected[name]
            require(entry['Bytes'] == len(data) and entry['Sha256'] == hashlib.sha256(data).hexdigest(),
                    'Manifest mismatch: ' + name)
    validation = read_json(regular(root / 'docs/publication/local-validation.json'))
    counts = validation.get('Node', {})
    require(validation.get('ArchiveSha256') == ARCHIVE_SHA
            and all(validation.get(k) is True for k in ('BuildPassed', 'VendorVerificationPassed', 'WorkerVerificationPassed'))
            and validation.get('PackagedConsumers') == 18
            and all(type(counts.get(k)) is int and counts[k] >= 0 for k in ('tests', 'pass', 'fail', 'cancelled', 'skipped'))
            and counts['tests'] >= 446 and counts['pass'] > 0
            and counts['fail'] == counts['cancelled'] == counts.get('todo', 0) == 0
            and counts['tests'] == counts['pass'] + counts['skipped'], 'Recorded local validation did not pass')
    build = read_json(regular(root / 'artifacts/build-result.json'))
    packages = read_json(regular(root / 'artifacts/package-consumer-result.json'))
    fingerprint = validation.get('SourceFingerprint')
    require(isinstance(fingerprint, str) and re.fullmatch(r'[0-9a-f]{64}', fingerprint)
            and build.get('SourceFingerprint') == fingerprint and build.get('XamlModules') == 75
            and packages.get('SourceFingerprint') == packages.get('FinalSourceFingerprint') == fingerprint
            and packages.get('Passed') is True and packages.get('Packages') == 18,
            'Build/package evidence does not match the recorded source fingerprint')
    state = {'Schema': 2, 'Repository': repo, 'Branch': branch, 'BaseCommit': base,
             'Commit': commit, 'BackupTag': backup, 'ArchiveSha256': ARCHIVE_SHA,
             'VerifiedFiles': len(entries), 'RecordedNode': counts,
             'Verification': 'Committed bytes and recorded validation checked; tests were not rerun by resume.'}
    print('Verified committed workspace: %s files; HEAD %s; backup %s' % (len(entries), commit, backup), flush=True)
    return state


def urls(repo):
    return {'https': 'https://github.com/' + repo + '.git',
            'ssh': 'git@github.com:' + repo + '.git',
            'ssh-443': 'ssh://git@ssh.github.com:443/' + repo + '.git'}


def transport_command(root, repo, transport):
    url = urls(repo)[transport]
    allowed = {u.lower().removesuffix('.git') for u in urls(repo).values()}
    for args in [('remote', 'get-url', '--all', 'origin'),
                 ('remote', 'get-url', '--push', '--all', 'origin'),
                 ('ls-remote', '--get-url', url)]:
        actual = text(root, *args).splitlines()
        require(len(actual) == 1 and actual[0].lower().removesuffix('.git') in allowed,
                'Remote URL/rewrite does not identify the selected GitHub repository. Refusing publication.')
    # Command-scoped, bounded HTTP compatibility workaround. Never a global setting.
    # Explicit URL avoids accidental multiple pushurl destinations. TLS remains enabled.
    command = ['git', '-C', str(root), '-c', 'credential.helper=',
               '-c', 'credential.helper=!gh auth git-credential',
               '-c', 'http.version=HTTP/1.1', '-c', 'http.postBuffer=67108864',
               '-c', 'http.https://github.com/.version=HTTP/1.1',
               '-c', 'http.https://github.com/.postBuffer=67108864',
               '-c', 'push.followTags=false', '-c', 'remote.origin.mirror=false']
    return command, url


def snapshot(command, url, state, session, tries=3):
    branch_ref, tag_ref = 'refs/heads/' + state['Branch'], 'refs/tags/' + state['BackupTag']
    error = ''
    for attempt in range(tries):
        try:
            proc = subprocess.run([*command, 'ls-remote', '--refs', url, branch_ref, tag_ref],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
                                  env={**os.environ, 'LC_ALL': 'C'})
            if proc.returncode:
                error = proc.stderr.decode('utf-8', 'replace')
            else:
                refs = {}
                for line in proc.stdout.decode('utf-8').splitlines():
                    oid, name = line.split('\t', 1)
                    require(name in (branch_ref, tag_ref) and name not in refs and OID_RE.fullmatch(oid),
                            'Unexpected or duplicate remote ref response')
                    refs[name] = oid
                head, tag = refs.get(branch_ref), refs.get(tag_ref)
                if head not in (state['BaseCommit'], state['Commit']) or tag not in (None, state['BaseCommit']):
                    status = 'conflict'
                elif head == state['Commit'] and tag == state['BaseCommit']:
                    status = 'verified'
                else:
                    status = 'ready'
                result = {'Status': status, 'ObservedHead': head, 'ObservedBackup': tag,
                          'Commit': state['Commit'], 'BaseCommit': state['BaseCommit'],
                          'BackupTag': state['BackupTag'], 'TransportUrl': url}
                write_json(session / 'remote-state.json', result)
                return result
        except subprocess.TimeoutExpired:
            error = 'Timed out reading remote refs'
        (session / 'remote-read-error.log').write_text(error, encoding='utf-8')
        if attempt + 1 < tries:
            time.sleep(2 ** attempt)
    raise RuntimeError('Remote refs could not be verified; no further push will be attempted. See ' + str(session / 'remote-read-error.log'))


def ensure_expected(remote):
    require(remote['Status'] != 'conflict',
            'Remote branch or backup tag changed unexpectedly. No overwrite/rebase/force retry is allowed. '
            + json.dumps(remote))


def stop_process(proc):
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()


def logged_push(command, logfile):
    errors = []
    with logfile.open('xb') as log:
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                start_new_session=True, env={**os.environ, 'LC_ALL': 'C'})
        def pump():
            try:
                while True:
                    data = proc.stdout.read1(65536)
                    if not data:
                        break
                    log.write(data)
                    log.flush()
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
            except (OSError, ValueError) as exc:
                errors.append(str(exc))
        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        try:
            code = proc.wait(timeout=900)
        except subprocess.TimeoutExpired:
            stop_process(proc)
            code = 124
        except BaseException:
            stop_process(proc)
            raise
        finally:
            reader.join(timeout=10)
            proc.stdout.close()
        return code, errors


def retryable(log):
    permanent = r'HTTP (?:401|403)|error: (?:401|403)|authentication failed|permission denied|protected branch|repository rule|GH00[136]|remote rejected|non-fast-forward|fetch first|does not support.*atomic|atomic push failed'
    transient = r'RPC failed; HTTP (?:400|408|429|5[0-9]{2})|curl (?:18|22|28|35|52|55|56|92)\b|unexpected disconnect|remote end hung up|connection (?:reset|closed|timed out)|could not resolve|unable to access|timed out'
    return not re.search(permanent, log, re.I) and bool(re.search(transient, log, re.I))


def transfer(work, state, transport, session, check_only=False):
    root = workspace(work)
    require(text(root, 'rev-parse', '--verify', 'HEAD') == state['Commit'], 'Local HEAD changed after verification')
    command, url = transport_command(root, state['Repository'], transport)
    remote = snapshot(command, url, state, session)
    ensure_expected(remote)
    if check_only:
        print('Remote publication state: ' + remote['Status'], flush=True)
        return
    for attempt in range(1, 4):
        if remote['Status'] == 'verified':
            write_json(work / 'push-verification-v2.json', remote)
            print('Both remote refs verified. No additional push is required.', flush=True)
            return
        # Persist intent before upload: a transport error is NOT proof of rejection.
        write_json(work / 'push-verification-v2.json', {**remote, 'Status': 'unverified', 'Attempt': attempt})
        logfile = session / ('push-attempt-%d.log' % attempt)
        print('Atomic push attempt %d/3 via %s (HTTPS: HTTP/1.1, 64 MiB POST buffer).' % (attempt, transport), flush=True)
        code, log_errors = logged_push([*command, 'push', '--porcelain', '--progress', '--atomic', url,
                                      state['BaseCommit'] + ':refs/tags/' + state['BackupTag'],
                                      state['Commit'] + ':refs/heads/' + state['Branch']], logfile)
        # Query authoritative refs even after a nonzero exit or misleading output.
        remote = snapshot(command, url, state, session)
        ensure_expected(remote)
        if remote['Status'] == 'verified':
            write_json(work / 'push-verification-v2.json', {**remote, 'GitExitCode': code})
            print('Verified remote branch AND backup tag' + (' despite a lost/error push response.' if code else '.'), flush=True)
            require(not log_errors, 'Remote refs are verified, but writing the local push log/output failed: ' + str(log_errors))
            return
        require(not log_errors, 'Local push log/output failed: ' + str(log_errors))
        output = logfile.read_text(encoding='utf-8', errors='replace')
        require(code != 0, 'Git reported success, but remote refs do not match; refusing to claim completion')
        require(attempt < 3 and (code == 124 or retryable(output)),
                'Push is not verified. See ' + str(logfile) + '. Resume later; an explicitly selected --transport ssh or ssh-443 can avoid HTTPS transport problems. Server policy/authentication errors require fixing the reported cause.')
        time.sleep(2 ** attempt)
        remote = snapshot(command, url, state, session)
        ensure_expected(remote)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation', choices=('verify', 'check', 'push'))
    p.add_argument('work', type=Path)
    p.add_argument('repo')
    p.add_argument('branch')
    p.add_argument('session', type=Path)
    p.add_argument('--backup-tag', default='')
    p.add_argument('--transport', choices=('https', 'ssh', 'ssh-443'), default='https')
    a = p.parse_args()
    work, session = a.work.resolve(strict=True), a.session.resolve(strict=True)
    require(session.parent == work and session.name.startswith('.publisher-v2.'), 'Invalid diagnostic directory')
    if a.operation == 'verify':
        result = verify(work, a.repo, a.branch, a.backup_tag)
        write_json(session / 'local-state.json', result)
    else:
        state = read_json(regular(session / 'local-state.json'))
        require(state.get('Repository') == a.repo and state.get('Branch') == a.branch, 'Wrong destination in local state')
        if a.operation == 'push':
            # A durable checkpoint exists before the first upload. No shell evaluation.
            write_json(work / 'publication-state-v2.json', state)
        transfer(work, state, a.transport, session, check_only=a.operation == 'check')


if __name__ == '__main__':
    # Terminating the supervisor must not leave a receive-pack client running.
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print('Interrupted. The remote state may be ambiguous; resume to verify it.', file=sys.stderr)
        raise SystemExit(130)
PUBLISH_RECOVERY_PY

if [ -z "$RESUME" ]; then
# All filesystem mutation is restricted to the private workspace created above.
cat > "$WORK/publish-helper.py" <<'PY_HELPER'
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import unicodedata

mode, work_arg, *args = sys.argv[1:]
work = Path(work_arg).resolve(strict=True)
if (work / '.publisher-workspace').read_text().strip() != 'weblonia-publisher-v1':
    raise SystemExit('Invalid publisher workspace')
root = work / 'repo'

def require(ok, message):
    if not ok:
        raise SystemExit(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def regular_files(directory):
    result = []
    for current, dirs, names in os.walk(directory):
        dirs[:] = sorted(d for d in dirs if d not in {'.git', 'node_modules', '__pycache__', 'package-consumer'}
                         and not (Path(current) == directory and d == 'upstream'))
        for d in dirs:
            require(not Path(current, d).is_symlink(), 'Unexpected symlink directory: ' + d)
        for name in names:
            if name == '.DS_Store' or name.endswith('.pyc'):
                continue
            file = Path(current, name)
            require(not file.is_symlink() and file.is_file(), 'Not a regular file: ' + str(file))
            require(file.stat().st_size < 100 * 1024 * 1024, 'GitHub file-size limit: ' + str(file))
            require(file.suffix.lower() not in {'.ttf','.otf','.woff','.woff2','.ttc','.otc','.pfa','.pfb'}, 'Do not distribute font files: ' + str(file))
            result.append(file)
    return sorted(result)

def read_node_test_summary(log_path):
    """Read one complete Node TAP/spec summary without relaxing test gates.

    Node 23 changed the non-TTY default reporter from TAP to spec. A pipe to
    tee therefore does not guarantee '# tests ...' lines. Keep npm test and
    NODE_OPTIONS untouched; accept either built-in reporter's actual counters.
    """
    log_path = Path(log_path)
    log = log_path.read_text(encoding='utf-8', errors='replace')
    # Strip terminal OSC sequences (e.g. hyperlinks) and CSI sequences (colors).
    log = re.sub(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)', '', log)
    log = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', log)
    log = log.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n')
    names = ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
    matches = re.findall(
        r'^(#|\u2139[\ufe0e\ufe0f]?)[^\S\r\n]+'
        r'(tests|pass|fail|cancelled|skipped|todo)[^\S\r\n]+'
        r'([0-9]+)[^\S\r\n]*$', log, re.M)
    counts = {}
    reporters = set()
    for name in names:
        found = [(prefix, int(value)) for prefix, key, value in matches if key == name]
        require(len(found) == 1,
                'Node test summary is missing or ambiguous: ' + name + '. '
                "Expected one complete TAP ('# tests N') or spec ('\u2139 tests N') "
                'summary. Inspect ' + str(log_path))
        prefix, counts[name] = found[0]
        reporters.add('tap' if prefix == '#' else 'spec')
    require(len(reporters) == 1,
            'Mixed Node test reporter summaries; refusing to combine counters: ' + str(log_path))
    require(counts['tests'] == sum(counts[name] for name in names if name != 'tests'),
            'Inconsistent Node test summary totals: ' + str(counts))
    require(counts['tests'] >= 446 and counts['pass'] > 0
            and counts['fail'] == 0 and counts['cancelled'] == 0 and counts['todo'] == 0,
            'Node tests did not complete cleanly: ' + str(counts))
    # Optional native-font skips are retained and reported, never counted as passes.
    return counts

def replace_once(file, old, new):
    text = file.read_text()
    require(text.count(old) == 1, 'Unexpected source layout; refusing partial patch: ' + str(file))
    file.write_text(text.replace(old, new))

if mode == 'extract':
    zip_path, expected_sha = args
    archive = Path(zip_path)
    require(sha(archive.read_bytes()) == expected_sha, 'ZIP SHA-256 mismatch: expected the unmodified AvaloniaWeb-0.6.2-alpha.1-source.zip')
    target = work / 'extracted'
    target.mkdir()
    with ZipFile(archive) as z:
        infos = z.infolist()
        require(sum(i.file_size for i in infos) < 256 * 1024 * 1024, 'Archive is unexpectedly large')
        seen = set()
        for i in infos:
            parts = PurePosixPath(i.filename).parts
            require(parts and parts[0] == 'AvaloniaWeb' and len(parts) >= 1, 'Wrong archive root')
            require(not i.filename.startswith('/') and '\\' not in i.filename and ':' not in i.filename, 'Unsafe ZIP path')
            require(not any(p in {'.', '..', '.git', 'node_modules'} for p in parts), 'Unsafe ZIP member')
            require(not any(ord(c) < 32 for c in i.filename), 'Control character in ZIP member')
            key = unicodedata.normalize('NFC', i.filename.rstrip('/')).casefold()
            require(key not in seen, 'Duplicate or case-colliding ZIP member')
            seen.add(key)
            kind = stat.S_IFMT(i.external_attr >> 16)
            require(kind in (0, stat.S_IFREG, stat.S_IFDIR), 'ZIP contains symlink/special file')
            require(i.file_size < 100 * 1024 * 1024, 'ZIP member exceeds GitHub file-size limit')
        manifest = json.loads(z.read('AvaloniaWeb/SOURCE-MANIFEST.json'))
        require(manifest['Version'] == '0.6.2-alpha.1' and len(manifest['Files']) == 1932, 'Unexpected source manifest')
        expected = {e['Path']: e for e in manifest['Files']}
        names = {i.filename[len('AvaloniaWeb/'):] for i in infos if not i.is_dir()}
        require(names == set(expected) | {'SOURCE-MANIFEST.json'}, 'Archive inventory differs from manifest')
        for i in infos:
            if i.is_dir():
                continue
            relative = i.filename[len('AvaloniaWeb/'):]
            data = z.read(i)  # Also validates the member CRC.
            if relative in expected:
                e = expected[relative]
                require(len(data) == e['Bytes'] and sha(data) == e['Sha256'], 'Archive integrity mismatch: ' + relative)
            out = target / i.filename
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            out.chmod(0o755 if (i.external_attr >> 16) & 0o111 else 0o644)
    print('Verified ZIP SHA-256, all 1,932 manifest entries, and all ZIP CRCs.')

elif mode == 'replace':
    require(root.is_dir() and not root.is_symlink() and (root / '.git').is_dir(), 'Refusing cleanup outside the fresh clone')
    top = subprocess.check_output(['git', '-C', str(root), 'rev-parse', '--show-toplevel'], text=True).strip()
    require(Path(top).resolve() == root, 'Git working tree is not the expected fresh clone')
    # The only deletion operation: top-level entries of this NEW private clone.
    for item in root.iterdir():
        if item.name == '.git':
            continue
        if item.is_dir() and not item.is_symlink():
            shutil.rmtree(item)
        else:
            item.unlink()
    shutil.copytree(work / 'extracted/AvaloniaWeb', root, dirs_exist_ok=True)
    pub = root / 'docs/publication'
    pub.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'SOURCE-MANIFEST.json', pub / 'archive-0.6.2-alpha.1-manifest.json')
    shutil.copy2(args[0], root / 'scripts/publish-weblonia.sh')
    (root / 'scripts/publish-weblonia.sh').chmod(0o755)
    require(not (root / '.import').exists() and not (root / '.github/workflows/import-source.yml').exists(), 'Incomplete cleanup')
    print('Replaced the clone file tree; preserved .git and all history.')

elif mode == 'patch':
    repo, branch, pages = args
    app = root / 'samples/ControlCatalog/app.js'
    replace_once(app,
        "const mode=globalThis.AVALONIA_BOOT_OPTIONS?.ThreadingMode??globalThis.AVALONIA_THREADING??new URLSearchParams(location.search).get('threading')??'single';",
        "const mode=ResolveCatalogThreadingMode();")
    replace_once(app, "import { CatalogController, CatalogApplication } from './catalog.js';",
        "import { CatalogController, CatalogApplication } from './catalog.js';\nimport { ResolveCatalogThreadingMode } from './threading-mode.js';")
    replace_once(app,
        "ThreadingMode: globalThis.AVALONIA_THREADING ?? new URLSearchParams(location.search).get('threading') ?? 'single'",
        'ThreadingMode: mode')
    # These tests inspect UI objects on window.catalog; make their SINGLE-thread
    # fixture explicit. Dedicated worker tests retain their original mode choices.
    for name in ['browser.py', 'automation-incremental.py', 'scrollbars.py', 'performance-trace.py']:
        file = root / 'tests' / name
        replace_once(file, '<head><base href=', '<head><script>globalThis.AVALONIA_THREADING="single";</script><base href=')
    replace_once(root / 'tests/browser.py', '    if args.url: page.goto(args.url)',
        '    if args.url:\n        page.add_init_script("globalThis.AVALONIA_THREADING = \'single\';")\n        page.goto(args.url)')
    replace_once(root / 'tests/http-smoke.py', "url = f'http://127.0.0.1:{port}/'", "url = f'http://127.0.0.1:{port}/?threading=single'")
    file = root / 'package.json'
    package = json.loads(file.read_text())
    package['scripts']['test:pages'] = 'python3 tests/pages-smoke.py'
    file.write_text(json.dumps(package, indent=2) + '\n')
    file = root / '.github/workflows/pages.yml'
    workflow = file.read_text().replace('__BRANCH__', json.dumps(branch)).replace('__BRANCH_RAW__', branch).replace('__SITE_NAME__', json.dumps(repo.split('/')[1]))
    if pages == '0':
        workflow = workflow.replace('  push:\n    branches: [' + json.dumps(branch) + ']\n', '')
    file.write_text(workflow)
    # Preserve archived evidence and duplicate vendor trees byte for byte on Git checkout.
    with (root / '.gitattributes').open('a') as f:
        f.write('\n*.sh text eol=lf\nartifacts/** -text\ndocs/recovery/** -text\ndist/docs/recovery/** -text\ndist/vendor/** -text\npackages/browser/worker-assets/vendor/** -text\ndist/packages/browser/worker-assets/vendor/** -text\n')
    with (root / '.gitignore').open('a') as f:
        f.write('\n# Private publication scratch files are never source.\n.venv/\n.import/\n')
    note = f'''# Weblonia publication\n\nRepository: {repo}; branch: {branch}.\n\nThis is the complete 0.6.2-alpha.1 source archive, including its worker-performance\nand invalidation fixes, plus the publication integration. ControlCatalog now\ndefaults to `full-isolation`; `?threading=single` and `?threading=render-worker`\nremain supported. The library default has not been changed.\n\nThe original manifest is retained at\n`docs/publication/archive-0.6.2-alpha.1-manifest.json`. The root manifest describes\nthis imported file tree. Original browser/performance reports are historical and\ndo not qualify changed sources. `docs/publication/local-validation.json` records\nwhat the publisher actually ran. CI reruns the original full regression workflow.\n\nThe Pages workflow builds `dist/`, verifies generated worker assets and packaged\nlibraries, then runs `tests/pages-smoke.py` against an ordinary HTTP server mounted\nunder `/{repo.split('/')[1]}/`. It checks the queryless default and all three explicit\nmodes, canonical module workers, native nonblank output and missing assets.\nIt uses no request interception, worker-URL replacements or cross-origin isolation\nheaders. A successful deployment is stamped in `dist/deployment.json`.\n\nNo npm install is needed for the delivered JavaScript application. Python browser\ntests use tests/requirements.txt. No fonts are copied from the developer machine.\nThis publication does not claim complete upstream Avalonia/XamlX parity.\n'''
    (root / 'docs/PUBLISHING.md').write_text(note)
    file = root / 'README.md'
    file.write_text('> **Weblonia publication:** ControlCatalog defaults to **full-isolation**.\n> Explicit `single` and `render-worker` URL overrides remain available.\n> See [publication details](docs/PUBLISHING.md) for validation scope and deployment.\n\n' + file.read_text())
    print('Applied catalog default, explicit single-thread test fixtures, and Pages workflow.')

elif mode == 'validate-node-tests':
    node = read_node_test_summary(work / 'node-tests.log')
    (work / 'node-test-summary.json').write_text(json.dumps(node, indent=2) + '\n')
    print('Verified Node test summary: ' + str(node))

elif mode == 'finalize':
    zip_sha, browser_ran = args
    # Revalidate the actual log; do not trust a stale summary from an earlier run.
    node = read_node_test_summary(work / 'node-tests.log')
    consumer = json.loads((root / 'artifacts/package-consumer-result.json').read_text())
    require(consumer['Passed'] and consumer['Packages'] == 18, 'Package consumer validation failed')
    build = json.loads((root / 'artifacts/build-result.json').read_text())
    require(build['XamlModules'] == 75, 'Unexpected AOT module count')
    report = {'ArchiveSha256': zip_sha, 'SourceFingerprint': build['SourceFingerprint'],
              'Node': node, 'BuildPassed': True, 'VendorVerificationPassed': True,
              'WorkerVerificationPassed': True, 'PackagedConsumers': 18,
              'LocalHttpBrowserTestsRun': browser_ran == '1',
              'CompleteBrowserReleaseGateRunLocally': False, 'RemotePushVerified': False,
              'Note': 'This report is created before pushing. Remote completion is recorded outside the source tree.'}
    if browser_ran == '1':
        smoke = json.loads((root / 'artifacts/publication/pages-smoke.json').read_text())
        require(smoke['Completed'] and smoke['Passed'] == 4 and smoke['Failed'] == 0, 'HTTP browser tests failed')
        report['HttpSmokeTests'] = smoke
    (root / 'docs/publication/local-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    paths = regular_files(root)
    original = json.loads((root / 'docs/publication/archive-0.6.2-alpha.1-manifest.json').read_text())
    current_names = {p.relative_to(root).as_posix() for p in paths}
    require(all(e['Path'] in current_names for e in original['Files']), 'An original archive file is missing')
    require(not any('.import' in Path(p).parts for p in current_names), 'Transfer fragments must not be published')
    entries = []
    for file in paths:
        name = file.relative_to(root).as_posix()
        if name != 'SOURCE-MANIFEST.json':
            data = file.read_bytes()
            entries.append({'Path': name, 'Bytes': len(data), 'Sha256': sha(data)})
    (root / 'SOURCE-MANIFEST.json').write_text(json.dumps({'Version': '0.6.2-alpha.1', 'Files': entries, 'ManifestExcludesItself': True, 'FontFiles': 0}, indent=2) + '\n')
    paths = regular_files(root)
    names = [p.relative_to(root).as_posix() for p in paths]
    subprocess.run(['git','-C',str(root),'add','-A','--','.'], check=True)
    # Include the verified archive's normally ignored logs/tarballs, but never
    # blindly force-add node_modules, scratch directories or unrelated local files.
    for offset in range(0, len(names), 200):
        subprocess.run(['git','-C',str(root),'add','--force','--',*names[offset:offset+200]], check=True)
    raw = subprocess.check_output(['git','-C',str(root),'ls-files','--stage','-z'])
    index = {}
    for line in raw.split(b'\0'):
        if not line:
            continue
        metadata, name = line.split(b'\t', 1)
        file_mode, oid, stage = metadata.decode().split()
        require(stage == '0' and file_mode in {'100644','100755'}, 'Unexpected index entry')
        index[name.decode()] = oid
    require(set(index) == set(names), 'Index differs from the complete source file inventory')
    algorithm = subprocess.check_output(['git','-C',str(root),'rev-parse','--show-object-format'], text=True).strip()
    for file, name in zip(paths, names):
        data = file.read_bytes()
        oid = hashlib.new(algorithm, b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        require(index[name] == oid, 'Git filters/line-ending conversion changed staged bytes: ' + name)
    (work / 'staged-files.json').write_text(json.dumps(names, indent=2) + '\n')
    print(f'Validated and staged {len(names)} files, byte-for-byte. Node: {node}')
else:
    raise SystemExit('Unknown helper operation: ' + mode)
PY_HELPER

log 'Verifying and extracting the exact source archive before running its build scripts'
python3 "$WORK/publish-helper.py" extract "$WORK" "$ZIP" "$EXPECTED_SHA256"

BASE_SHA=''
BACKUP_TAG=''
if [ "$DRY_RUN" -eq 1 ]; then
    log 'Dry run: creating a disposable Git repository; no GitHub access'
    git init --quiet "$REPO_DIR"
else
    need gh
    log "Checking GitHub access: $REPO ($BRANCH)"
    api "repos/$REPO" > "$WORK/repository.json"
    python3 - "$WORK/repository.json" "$BRANCH" <<'PY'
import json, sys
r=json.load(open(sys.argv[1]))
if r.get('archived') or r.get('disabled'): raise SystemExit('Destination repository is archived or disabled.')
if not r.get('permissions', {}).get('push'): raise SystemExit('The authenticated account lacks repository push permission.')
if r['default_branch'] != sys.argv[2]: raise SystemExit('Use the repository default branch: '+r['default_branch'])
PY
    # Credentials stay in gh; no tokens appear in URLs, scripts or the Git bundle.
    case "$TRANSPORT" in
        https) CLONE_URL="https://github.com/$REPO.git" ;;
        ssh) CLONE_URL="git@github.com:$REPO.git" ;;
        ssh-443) CLONE_URL="ssh://git@ssh.github.com:443/$REPO.git" ;;
    esac
    git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
        -c http.version=HTTP/1.1 clone --no-checkout -- "$CLONE_URL" "$REPO_DIR"
    git -C "$REPO_DIR" config --local --add credential.helper ''
    git -C "$REPO_DIR" config --local --add credential.helper '!gh auth git-credential'
    git -C "$REPO_DIR" config --local core.autocrlf false
    git -C "$REPO_DIR" checkout -B "$BRANCH" "refs/remotes/origin/$BRANCH"
    git -C "$REPO_DIR" var GIT_AUTHOR_IDENT >/dev/null || die 'Configure Git user.name and user.email before publishing.'
    BASE_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
    log 'Backing up the fetched Git history locally'
    git -C "$REPO_DIR" bundle create "$WORK/remote-before-import.bundle" --all
    git -C "$REPO_DIR" bundle verify "$WORK/remote-before-import.bundle"
    BACKUP_TAG="backup/pre-weblonia-import-$(date -u +%Y%m%dT%H%M%SZ)-$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
    git check-ref-format "refs/tags/$BACKUP_TAG" >/dev/null || die 'Invalid generated backup tag.'
    printf '%s\n' "$BASE_SHA" > "$WORK/base-commit.txt"
fi
# Avoid machine-specific global attributes silently rewriting verified binaries.
git -C "$REPO_DIR" config --local core.autocrlf false
git -C "$REPO_DIR" config --local core.attributesFile /dev/null

log 'Cleaning only the fresh clone, then copying the complete verified source tree'
python3 "$WORK/publish-helper.py" replace "$WORK" "$SELF"

cat > "$REPO_DIR/samples/ControlCatalog/threading-mode.js" <<'CATALOG_MODE_JS'
/** ControlCatalog policy only; the library's default is intentionally unchanged. */
export function ResolveCatalogThreadingMode(
    search = globalThis.location?.search ?? '',
    bootOptions = globalThis.AVALONIA_BOOT_OPTIONS,
    legacyMode = globalThis.AVALONIA_THREADING
) {
    return bootOptions?.ThreadingMode ?? legacyMode
        ?? new URLSearchParams(search).get('threading') ?? 'full-isolation';
}
CATALOG_MODE_JS

cat > "$REPO_DIR/tests/catalog-default.test.mjs" <<'CATALOG_MODE_TEST_JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolveCatalogThreadingMode as resolve } from '../samples/ControlCatalog/threading-mode.js';

test('catalog defaults to full isolation with no override', () => assert.equal(resolve(''), 'full-isolation'));
for (const mode of ['single', 'render-worker', 'full-isolation']) {
    test(`catalog keeps explicit ${mode} URL override`, () => assert.equal(resolve(`?threading=${mode}`), mode));
}
test('catalog legacy override precedes the URL', () => assert.equal(resolve('?threading=full-isolation', undefined, 'single'), 'single'));
test('catalog boot options precede legacy and URL overrides', () => assert.equal(resolve('?threading=single', { ThreadingMode: 'full-isolation' }, 'render-worker'), 'full-isolation'));
CATALOG_MODE_TEST_JS

cat > "$REPO_DIR/tests/pages-smoke.py" <<'PAGES_SMOKE_PY'
"""Ordinary HTTP, subdirectory-hosted ControlCatalog startup; no request interception.
Run after npm run build. Requires the packages in tests/requirements.txt.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, quote
from threading import Thread
from playwright.sync_api import sync_playwright
from PIL import Image
from verification_support import source_fingerprint
import argparse
import base64
import io
import json
import os
import time

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site-name', default='Weblonia')
args = parser.parse_args()
if not args.site_name or '/' in args.site_name or args.site_name in ('.', '..'):
    parser.error('site-name must be one path segment')
prefix = '/' + quote(args.site_name, safe='') + '/'
output = ROOT / 'artifacts/publication'
output.mkdir(parents=True, exist_ok=True)
report = {'Completed': False, 'Passed': 0, 'Failed': 0, 'Tests': [],
          'SourceFingerprint': source_fingerprint(ROOT), 'Interception': False,
          'WorkerBootstrapOverrides': False, 'IsolationHeaders': False,
          'HardwareGPUQualified': False, 'SitePrefix': prefix}

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.js': 'text/javascript',
                      '.mjs': 'text/javascript'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'dist'), **kw)

    def do_GET(self):
        if not urlsplit(self.path).path.startswith(prefix):
            self.send_error(404, 'Outside the project Pages prefix')
            return
        self.path = '/' + self.path[len(prefix):]
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
origin = 'http://127.0.0.1:' + str(server.server_port)
try:
    with sync_playwright() as pw:
        launch = {'headless': True, 'args': ['--disable-dev-shm-usage']}
        executable = os.environ.get('CHROMIUM_PATH')
        if executable:
            launch['executable_path'] = executable
        with pw.chromium.launch(**launch) as browser:
            report['Browser'] = browser.version
            # First case is the actual queryless default (automatic backend).
            cases = [('default', '', 'full-isolation'),
                     ('single', '?threading=single&backend=canvas', 'single'),
                     ('render-worker', '?threading=render-worker&backend=canvas', 'render-worker'),
                     ('full-isolation', '?threading=full-isolation&backend=canvas', 'full-isolation')]
            for name, query, mode in cases:
                errors, missing = [], []
                result = {'Name': name, 'ExpectedMode': mode, 'Passed': False}
                started = time.monotonic()
                context = browser.new_context(viewport={'width': 1200, 'height': 900},
                                              device_scale_factor=1.25)
                page = context.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                context.on('response', lambda r: missing.append(r.url)
                           if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)
                try:
                    response = page.goto(origin + prefix + query, wait_until='domcontentloaded', timeout=30000)
                    assert response and response.status == 200, 'Entry document did not return HTTP 200'
                    page.wait_for_function('globalThis.catalogReady || globalThis.catalogError', timeout=90000)
                    state = page.evaluate('({Ready:!!globalThis.catalogReady, Error:globalThis.catalogError??null})')
                    assert state['Ready'] and not state['Error'], str(state)
                    expected_workers = {'single': 0, 'render-worker': 1, 'full-isolation': 2}[mode]
                    assert len(page.workers) == expected_workers, 'Incorrect dedicated-worker count'
                    for worker in page.workers:
                        assert worker.url.startswith(origin + prefix), 'Noncanonical worker URL: ' + worker.url
                    if mode == 'full-isolation':
                        diagnostics = page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
                        assert diagnostics['UI']['HasDocument'] is False
                        assert diagnostics['Renderer']['Worker']['HasDocument'] is False
                        page.evaluate("async()=>await catalogHost.InvokeAsync('Navigate','TableView')")
                    else:
                        page.evaluate("async()=>{await catalog.Navigate('TableView');await catalog.Root.RenderNow();}")
                        if mode == 'render-worker':
                            diagnostics = page.evaluate('async()=>await catalog.Root.Renderer.GetDiagnosticsAsync()')
                            assert diagnostics['Worker']['HasDocument'] is False
                    png = page.evaluate('''async isolated=>{
                        const bytes=await (isolated?catalogHost.CapturePngAsync():catalog.Root.CapturePngAsync());
                        let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
                        return btoa(s);
                    }''', mode == 'full-isolation')
                    image = Image.open(io.BytesIO(base64.b64decode(png))).convert('RGBA')
                    assert any(lo != hi for lo, hi in image.getextrema()[:3]), 'Blank native frame'
                    assert not errors and not missing, str({'Errors': errors, 'Missing': missing})
                    page.screenshot(path=str(output / (name + '.png')))
                    result.update(Passed=True, Workers=expected_workers, Width=image.width, Height=image.height)
                except Exception as exc:
                    result['Error'] = str(exc)
                finally:
                    result.update(Errors=errors, MissingAssets=missing,
                                  Milliseconds=round((time.monotonic() - started) * 1000))
                    report['Tests'].append(result)
                    context.close()
                    print(('PASS ' if result['Passed'] else 'FAIL ') + name, result.get('Error', ''), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    report['Completed'] = len(report['Tests']) == 4
    report['Passed'] = sum(t['Passed'] for t in report['Tests'])
    report['Failed'] = len(report['Tests']) - report['Passed']
    report['FinalSourceFingerprint'] = source_fingerprint(ROOT)
    (output / 'pages-smoke.json').write_text(json.dumps(report, indent=2) + '\n')

if not report['Completed'] or report['Failed'] or report['SourceFingerprint'] != report['FinalSourceFingerprint']:
    raise SystemExit(1)
PAGES_SMOKE_PY

cat > "$REPO_DIR/.github/workflows/pages.yml" <<'PAGES_WORKFLOW_YAML'
name: Publish ControlCatalog
on:
  push:
    branches: [__BRANCH__]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    permissions:
      contents: read
      pages: read
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          package-manager-cache: false
      - uses: actions/setup-python@v7
        with:
          python-version: '3.13'
      - run: npm run verify:vendor
      - run: npm test
      - run: npm run build
      - run: npm run verify:workers
      - run: npm run pack:all
      - run: npm run test:packages
      - run: python -m pip install -r tests/requirements.txt
      - run: python -m playwright install --with-deps chromium
      - name: Test ordinary HTTP startup under the project Pages path
        env:
          SITE_NAME: __SITE_NAME__
        run: python tests/pages-smoke.py --site-name "$SITE_NAME"
      - name: Stamp the exact deployed commit
        run: node --input-type=module -e 'import {writeFileSync} from "node:fs"; writeFileSync("dist/deployment.json",JSON.stringify({Commit:process.env.GITHUB_SHA,DefaultThreadingMode:"full-isolation"})+"\n");'
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist/
  deploy:
    if: github.ref == 'refs/heads/__BRANCH_RAW__'
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
PAGES_WORKFLOW_YAML

python3 "$WORK/publish-helper.py" patch "$WORK" "$REPO" "$BRANCH" "$PAGES"

# Use existing local fonts IN PLACE for optional native-font tests. Never copy them.
if [ -z "${AVALONIA_TEST_FONT:-}" ]; then
    for font in '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' \
                '/System/Library/Fonts/Supplemental/Arial.ttf' '/Library/Fonts/Arial.ttf'; do
        if [ -f "$font" ]; then export AVALONIA_TEST_FONT="$font"; break; fi
    done
fi
if [ -z "${AVALONIA_TEST_BOLD_FONT:-}" ]; then
    for font in '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' \
                '/System/Library/Fonts/Supplemental/Arial Bold.ttf' '/Library/Fonts/Arial Bold.ttf'; do
        if [ -f "$font" ]; then export AVALONIA_TEST_BOLD_FONT="$font"; break; fi
    done
fi
if [ ! -f "${AVALONIA_TEST_FONT:-}" ] || [ ! -f "${AVALONIA_TEST_BOLD_FONT:-}" ]; then
    printf '\nNOTE: Some native-font tests may skip. Set AVALONIA_TEST_FONT and\nAVALONIA_TEST_BOLD_FONT to existing regular/bold font files for those tests.\n'
fi
run_logged() {
    logfile=$1
    shift
    "$@" 2>&1 | tee "$WORK/$logfile"
}
cd "$REPO_DIR"
log 'Verifying vendor assets and rebuilding all generated XAML/worker/dist assets'
run_logged vendor.log npm run verify:vendor
run_logged build.log npm run build
run_logged workers.log npm run verify:workers
log 'Running the Node regression suite and rebuilding all 18 npm tarballs'
run_logged node-tests.log npm test
# Validate immediately so a reporter/summary problem is diagnosed before packing.
# set -o pipefail above still aborts on a failing npm test or tee invocation.
python3 "$WORK/publish-helper.py" validate-node-tests "$WORK"
run_logged packages.log npm run pack:all
run_logged package-consumers.log npm run test:packages
if [ "$BROWSER_TEST" -eq 1 ]; then
    log 'Installing browser test tools in a private virtual environment'
    python3 -m venv "$WORK/browser-venv"
    "$WORK/browser-venv/bin/python" -m pip install -r tests/requirements.txt
    "$WORK/browser-venv/bin/python" -m playwright install chromium
    run_logged pages-smoke.log "$WORK/browser-venv/bin/python" tests/pages-smoke.py --site-name "${REPO#*/}"
fi
log 'Rebuilding the source manifest and verifying every staged Git blob'
python3 "$WORK/publish-helper.py" finalize "$WORK" "$EXPECTED_SHA256" "$BROWSER_TEST"
git diff --cached --shortstat
printf '\nDestination: %s, branch %s\nDefault mode: full-isolation\nSource tree: %s\n' "$REPO" "$BRANCH" "$REPO_DIR"
if [ "$DRY_RUN" -eq 1 ]; then
    printf '\nDRY RUN PASSED. No GitHub access, push, commit or Pages change was made.\n'
    printf 'Inspect the staged source: git -C %q diff --cached --stat\n' "$REPO_DIR"
    printf 'All files and logs are retained in: %s\n' "$WORK"
    exit 0
fi

log 'Creating the local publication commit and backup tag (nothing pushed yet)'
if ! git diff --cached --quiet; then
    git commit --quiet -m 'Import complete AvaloniaWeb 0.6.2 sources; default to full isolation and publish ControlCatalog'
fi
git -c tag.gpgSign=false tag "$BACKUP_TAG" "$BASE_SHA"
SELECTED_TAG="$BACKUP_TAG"
else
    log 'Resuming committed source; no extraction, cleanup, build, tests, or new commit'
fi

log 'Verifying the exact committed source, original history backup, and saved validation'
python3 "$SESSION/recovery.py" verify "$WORK" "$REPO" "$BRANCH" "$SESSION" --backup-tag "$SELECTED_TAG"
COMMIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["Commit"])' "$SESSION/local-state.json")
BASE_SHA=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["BaseCommit"])' "$SESSION/local-state.json")
BACKUP_TAG=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["BackupTag"])' "$SESSION/local-state.json")
cd "$REPO_DIR"
if [ "$DRY_RUN" -eq 1 ]; then
    printf '\nRESUME DRY RUN PASSED. Committed source verified; tests were NOT rerun.\n'
    printf 'No GitHub access, source changes, commit, push or Pages changes were made.\n'
    exit 0
fi
need gh
if [ -n "$RESUME" ]; then
    api "repos/$REPO" > "$SESSION/repository-current.json"
    python3 - "$SESSION/repository-current.json" "$REPO" "$BRANCH" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
if r.get('full_name','').lower() != sys.argv[2].lower() or r.get('default_branch') != sys.argv[3]:
    raise SystemExit('GitHub repository identity/default branch changed; refusing publication.')
if r.get('archived') or r.get('disabled') or not r.get('permissions',{}).get('push'):
    raise SystemExit('Repository is not writable by this account.')
PY
fi
printf 'Pre-import commit: %s\nLocal history backup: %s\nRemote backup tag: %s\n' \
    "$BASE_SHA" "$WORK/remote-before-import.bundle" "$BACKUP_TAG"
if [ "$YES" -eq 0 ]; then
    printf '\nPublish the verified replacement commit to %s/%s.\n' "$REPO" "$BRANCH"
    printf 'Git history is preserved. Pages configuration/deployment enabled: %s\n' "$PAGES"
    [ -t 0 ] || die 'Confirmation requires an interactive terminal; use --yes after reviewing the script.'
    printf 'Type %s@%s to publish: ' "$REPO" "$BRANCH"
    IFS= read -r confirmation
    [ "$confirmation" = "$REPO@$BRANCH" ] || die 'Publication cancelled.'
fi

log 'Checking remote branch AND backup tag before publication'
python3 "$SESSION/recovery.py" check "$WORK" "$REPO" "$BRANCH" "$SESSION" --transport "$TRANSPORT"
if [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["Status"])' "$SESSION/remote-state.json")" = verified ]; then
    PUSHED=1
fi
if [ "$PAGES" -eq 1 ]; then
    PAGES_TOUCHED=1
    log 'Configuring GitHub Pages to use GitHub Actions (preserving any custom domain)'
    if api "repos/$REPO/pages" > "$SESSION/pages-before.json" 2> "$SESSION/pages-read-error.log"; then
        BUILD_TYPE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("build_type",""))' "$SESSION/pages-before.json")
        if [ "$BUILD_TYPE" != workflow ]; then
            api --method PUT "repos/$REPO/pages" -f build_type=workflow > "$SESSION/pages-update.json"
        fi
    else
        if grep -q 'HTTP 404' "$SESSION/pages-read-error.log"; then
            api --method POST "repos/$REPO/pages" -f build_type=workflow > "$SESSION/pages-create.json" \
                || die 'Cannot enable Pages. Check Pages/Administration permissions and your GitHub plan. No new source push was attempted in this step.'
        else
            cat "$SESSION/pages-read-error.log" >&2
            die 'Cannot read Pages settings. No new source push was attempted in this step.'
        fi
    fi
    api "repos/$REPO/pages" > "$SESSION/pages-configured.json"
    python3 - "$SESSION/pages-configured.json" <<'PY'
import json,sys
if json.load(open(sys.argv[1])).get('build_type') != 'workflow':
    raise SystemExit('Pages did not confirm GitHub Actions as its build source.')
PY
fi

log 'Publishing the existing commit and backup tag with verified, bounded transport retries'
PUSH_ATTEMPTED=1
python3 "$SESSION/recovery.py" push "$WORK" "$REPO" "$BRANCH" "$SESSION" --transport "$TRANSPORT"
PUSHED=1
printf '%s\n' "$COMMIT" > "$WORK/pushed-commit.txt"
printf '\nSource AND backup tag verified: https://github.com/%s/commit/%s\n' "$REPO" "$COMMIT"
printf 'Rollback reference: %s\nHistory bundle: %s\n' "$BACKUP_TAG" "$WORK/remote-before-import.bundle"
printf 'Push diagnostics: %s\n' "$SESSION"

if [ "$PAGES" -eq 0 ]; then
    printf '\nPages configuration and deployment were intentionally skipped.\n'
    printf 'Committed workflow triggers are unchanged by resume; an existing push trigger may still run.\n'
    exit 0
fi
if [ "$WAIT" -eq 0 ]; then
    printf '\nPages is configured to build on push; deployment has NOT been verified yet.\n'
    printf 'Watch: https://github.com/%s/actions/workflows/pages.yml\n' "$REPO"
    exit 0
fi

log 'Finding the Pages workflow for this exact commit'
RUN_ID=''
for ((attempt=1; attempt<=24; attempt++)); do
    RUN_ID=$(gh run list --repo "$REPO" --workflow pages.yml --branch "$BRANCH" \
        --commit "$COMMIT" --event push --limit 5 --json databaseId \
        --jq '.[0].databaseId // empty' 2> "$SESSION/pages-discovery.log" || true)
    [ -z "$RUN_ID" ] || break
    sleep 5
done
if [ -z "$RUN_ID" ]; then
    # A no-op push or delayed push trigger may require an explicit dispatch.
    python3 "$SESSION/recovery.py" check "$WORK" "$REPO" "$BRANCH" "$SESSION" --transport "$TRANSPORT"
    [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["Status"])' "$SESSION/remote-state.json")" = verified ] \
        || die 'Remote moved before Pages dispatch. Deployment is unverified.' 
    gh workflow run pages.yml --repo "$REPO" --ref "$BRANCH"
    for ((attempt=1; attempt<=24; attempt++)); do
        RUN_ID=$(gh run list --repo "$REPO" --workflow pages.yml --branch "$BRANCH" \
            --commit "$COMMIT" --event workflow_dispatch --limit 5 --json databaseId \
            --jq '.[0].databaseId // empty' 2> "$SESSION/pages-discovery.log" || true)
        [ -z "$RUN_ID" ] || break
        sleep 5
    done
fi
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || die "Source was pushed, but no Pages run could be identified. See https://github.com/$REPO/actions/workflows/pages.yml"
printf '%s\n' "$RUN_ID" > "$WORK/pages-run-id.txt"
printf 'Pages run: https://github.com/%s/actions/runs/%s\n' "$REPO" "$RUN_ID"

# Poll Actions REST rather than gh run watch, which has fine-grained PAT limitations.
deadline=$((SECONDS + 2100))
previous=''
while [ "$SECONDS" -lt "$deadline" ]; do
    state=$(api "repos/$REPO/actions/runs/$RUN_ID" --jq '[.status, (.conclusion // "pending")] | @tsv')
    if [ "$state" != "$previous" ]; then printf 'Pages: %s\n' "$state"; previous=$state; fi
    IFS=$'\t' read -r status conclusion <<< "$state"
    if [ "$status" = completed ]; then
        if [ "$conclusion" != success ]; then
            gh run view "$RUN_ID" --repo "$REPO" --log-failed > "$SESSION/pages-failure.log" 2>&1 || true
            die "Source push succeeded; Pages finished with '$conclusion'. See $SESSION/pages-failure.log and the run URL."
        fi
        break
    fi
    sleep 5
done
[ "$status" = completed ] || die 'Source push succeeded; Pages is still pending after 35 minutes. Check environment approvals and the run URL.'
SITE_URL=$(api "repos/$REPO/pages" --jq '.html_url')
log "Verifying the live deployed commit at $SITE_URL"
python3 - "$SITE_URL" "$COMMIT" "$WORK" <<'PY'
import json, sys, time, urllib.request
from pathlib import Path
site, commit, work = sys.argv[1:]
if not site.startswith('https://'): raise SystemExit('Unexpected Pages URL: ' + site)
last = 'not checked'
for attempt in range(24):
    try:
        url = site.rstrip('/') + '/deployment.json?commit=' + commit
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read(1024 * 1024))
        if result.get('Commit') == commit and result.get('DefaultThreadingMode') == 'full-isolation':
            Path(work, 'deployment-verified.json').write_text(json.dumps({'Verified':True, 'Url':site, **result}, indent=2)+'\n')
            print('Live deployment commit verified: ' + commit)
            break
        last = 'The CDN is still serving a different commit.'
    except Exception as error:
        last = str(error)
    time.sleep(5)
else:
    raise SystemExit('Pages workflow succeeded, but live verification did not: ' + last)
PY
printf '\nSUCCESS\nRepository: https://github.com/%s\nCommit: %s\nControlCatalog: %s\nDefault: full-isolation\nWorkspace and backups: %s\n' \
    "$REPO" "$COMMIT" "$SITE_URL" "$WORK"
