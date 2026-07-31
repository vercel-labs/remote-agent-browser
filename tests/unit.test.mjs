// Unit tests for the library layer (src/), using a mocked Sandbox so no
// real Vercel Sandbox or Chromium is needed.
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { createBrowserClient, flagsToArgs } from '../src/browser.ts'
import {
  DEFAULT_BROWSER_IMAGE,
  provisionBrowserSandbox,
} from '../src/vercel.ts'

// --- mock sandbox -----------------------------------------------------------

function makeCommand({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  return {
    wait: mock.fn(async () => ({ exitCode })),
    output: mock.fn(async (stream) => (stream === 'stderr' ? stderr : stdout)),
    kill: mock.fn(async () => {}),
  }
}

function makeSandbox(handler) {
  const calls = []
  return {
    calls,
    sandboxId: 'sbx_test123',
    status: 'running',
    stop: mock.fn(async () => {}),
    async runCommand(opts) {
      calls.push(opts)
      return handler ? handler(opts) : makeCommand()
    },
  }
}

// --- flagsToArgs ------------------------------------------------------------

describe('flagsToArgs', () => {
  it('serializes booleans, values, and arrays', () => {
    assert.deepEqual(flagsToArgs({ json: true }), ['--json'])
    assert.deepEqual(flagsToArgs({ fullPage: true, depth: 2 }), [
      '--full-page',
      '--depth',
      '2',
    ])
    assert.deepEqual(flagsToArgs({ enable: ['react-devtools', 'x'] }), [
      '--enable',
      'react-devtools',
      '--enable',
      'x',
    ])
    assert.deepEqual(flagsToArgs({ full: false, name: null, depth: undefined }), [])
  })
})

// --- browser client ---------------------------------------------------------

describe('createBrowserClient', () => {
  const runner = () => ({
    run: mock.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
    readFile: mock.fn(async () => Buffer.from('png-bytes')),
    close: mock.fn(async () => {}),
  })

  it('prefixes every command with the session', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.run([['open', 'https://example.com'], ['snapshot', '-i']])
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'open', 'https://example.com',
    ])
    assert.deepEqual(r.run.mock.calls[1].arguments[1], [
      '--session', 's1', 'snapshot', '-i',
    ])
    await browser.close()
  })

  it('stops on the first failure by default', async () => {
    const r = runner()
    r.run.mock.mockImplementationOnce(async () => ({
      stdout: '', stderr: 'boom', exitCode: 1,
    }))
    const browser = createBrowserClient(r, { session: 's1' })
    const out = await browser.run([['open', 'x'], ['snapshot']])
    assert.equal(out.ok, false)
    assert.equal(out.results.length, 1)
    assert.equal(r.run.mock.calls.length, 1)
    await browser.close()
  })

  it('collects file bytes for screenshot without a path', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const result = await browser.exec('screenshot')
    assert.equal(result.ok, true)
    assert.deepEqual(result.file.bytes, Buffer.from('png-bytes'))
    assert.equal(result.file.contentType, 'image/png')
    // a /tmp path was injected as the output arg
    const args = r.run.mock.calls[0].arguments[1]
    assert.match(args.at(-1), /^\/tmp\/agent-browser-.*\.png$/)
    await browser.close()
  })

  it('does not inject a path when the caller passes one', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.exec('screenshot', { args: ['/tmp/mine.png'] })
    const args = r.run.mock.calls[0].arguments[1]
    assert.ok(args.includes('/tmp/mine.png'))
    assert.ok(!args.some((a) => a.startsWith('/tmp/agent-browser-')))
    await browser.close()
  })

  it('collects files and validates names for an overridden session', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const result = await browser.exec('screenshot', { session: 's2' })
    assert.equal(result.file.contentType, 'image/png')
    assert.deepEqual(r.run.mock.calls[0].arguments[1].slice(0, 2), [
      '--session', 's2',
    ])
    await assert.rejects(
      browser.exec('snapshot', { session: 'not valid' }),
      /session must match/,
    )
    await browser.close()
  })

  it('closes the CLI session then the runner', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.close()
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'close',
    ])
    assert.equal(r.close.mock.calls.length, 1)
  })
})

// --- provisioning -----------------------------------------------------------

describe('provisionBrowserSandbox', () => {
  it('creates an ephemeral sandbox from the default browser image', async () => {
    const sandbox = makeSandbox()
    const factory = { create: mock.fn(async () => sandbox) }

    const runner = await provisionBrowserSandbox({ sandbox: factory })
    assert.ok(runner)

    assert.equal(factory.create.mock.calls.length, 1)
    const createOpts = factory.create.mock.calls[0].arguments[0]
    assert.equal(createOpts.image, DEFAULT_BROWSER_IMAGE)
    assert.deepEqual(createOpts.resources, { vcpus: 2 })
    assert.equal(createOpts.persistent, false)
    assert.deepEqual(createOpts.ports, [])
    assert.match(createOpts.env.AGENT_BROWSER_ARGS, /--no-sandbox/)
    // Image provisioning needs no install or warm-up commands.
    assert.equal(sandbox.calls.length, 0)
  })

  it('passes an explicit image, resources, timeout, and environment', async () => {
    const sandbox = makeSandbox()
    const factory = { create: mock.fn(async () => sandbox) }

    await provisionBrowserSandbox({
      sandbox: factory,
      image: 'browser@sha256:abc',
      vcpus: 4,
      timeoutMs: 123_000,
      env: { CUSTOM: 'yes' },
    })
    const createOpts = factory.create.mock.calls[0].arguments[0]
    assert.equal(createOpts.image, 'browser@sha256:abc')
    assert.deepEqual(createOpts.resources, { vcpus: 4 })
    assert.equal(createOpts.timeout, 123_000)
    assert.equal(createOpts.env.CUSTOM, 'yes')
  })
})
