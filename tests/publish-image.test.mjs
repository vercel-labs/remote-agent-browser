import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(
  new URL('../scripts/publish-image.sh', import.meta.url),
)

describe('publish-image.sh', () => {
  it('documents support for multiple image tags', () => {
    const result = spawnSync(script, ['--help'], { encoding: 'utf8' })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /\[tag \.\.\.\]/)
  })

  it('rejects an invalid image tag before accessing credentials', () => {
    const result = spawnSync(script, ['valid', 'not/valid'], {
      encoding: 'utf8',
    })

    assert.equal(result.status, 2)
    assert.match(result.stderr, /Invalid Docker image tag: not\/valid/)
  })

  it('publishes with a local OIDC token without calling the Vercel CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'publish-image-'))
    const dockerCalls = join(directory, 'docker-calls')
    const docker = join(directory, 'docker')
    const vercel = join(directory, 'vercel')

    writeFileSync(
      docker,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS_FILE"\nif [ "$1" = "login" ]; then cat >/dev/null; fi\n',
    )
    writeFileSync(vercel, '#!/bin/sh\nexit 99\n')
    chmodSync(docker, 0o755)
    chmodSync(vercel, 0o755)

    try {
      const result = spawnSync(script, ['v1.2.0', 'latest'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_CALLS_FILE: dockerCalls,
          PATH: `${directory}:${process.env.PATH}`,
          VERCEL_OIDC_TOKEN: 'local-oidc-token',
        },
      })

      assert.equal(result.status, 0, result.stderr)
      const calls = readFileSync(dockerCalls, 'utf8')
      assert.match(calls, /login vcr\.vercel\.com --username oidc/)
      assert.match(calls, /--tag .*:v1\.2\.0 --tag .*:latest/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
