// Unit tests for the library layer (src/), using a mocked Sandbox so no
// real Vercel Sandbox or Chromium is needed.
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Sandbox } from '@vercel/sandbox'

import { flagsToArgs } from '../src/browser.ts'
import {
  AgentBrowser,
  createAgentBrowser,
  createBrowserClient,
} from '../dist/index.js'
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
  const writes = []
  return {
    calls,
    writes,
    name: 'browser-test123',
    sandboxId: 'sbx_test123',
    status: 'running',
    expiresAt: new Date(Date.now() + 1_000),
    extendTimeout: mock.fn(async () => {}),
    stop: mock.fn(async () => {}),
    async runCommand(opts) {
      calls.push(opts)
      return handler ? handler(opts) : makeCommand()
    },
    async writeFiles(files) {
      writes.push(...files)
    },
  }
}

// --- public factory ---------------------------------------------------------

describe('AgentBrowser.create', () => {
  it('creates a session client from the requested image and owns its sandbox', async () => {
    const sandbox = makeSandbox()
    const create = mock.method(Sandbox, 'create', async () => sandbox)
    const get = mock.method(Sandbox, 'get', async () => sandbox)

    try {
      assert.equal(AgentBrowser.create, createAgentBrowser)
      const browser = await AgentBrowser.create({
        image: 'remote-agent-browser:v1',
        session: 'agent-session',
        args: ['--color-scheme', 'dark'],
      })

      assert.equal(browser.session, 'agent-session')
      assert.equal(
        create.mock.calls[0].arguments[0].image,
        'remote-agent-browser:v1',
      )

      await browser.exec('open', { args: ['https://example.com'] })
      assert.deepEqual(sandbox.calls[0].args, [
        '--session',
        'agent-session',
        '--color-scheme',
        'dark',
        'open',
        'https://example.com',
      ])

      const stopKeepalive = browser.keepalive({
        timeoutMs: 10_000,
        intervalMs: 1_000,
      })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(sandbox.extendTimeout.mock.calls.length, 1)
      const extensionMs = sandbox.extendTimeout.mock.calls[0].arguments[0]
      assert.ok(extensionMs >= 8_000 && extensionMs <= 10_000)
      stopKeepalive()

      await browser.close()
      assert.equal(sandbox.stop.mock.calls.length, 1)
    } finally {
      create.mock.restore()
      get.mock.restore()
    }
  })
})

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
    writeFile: mock.fn(async () => {}),
    close: mock.fn(async () => {}),
    keepalive: mock.fn(() => mock.fn()),
  })

  it('delegates keepalive to the runner', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const options = { timeoutMs: 20_000, intervalMs: 5_000 }
    const stop = browser.keepalive(options)

    assert.deepEqual(r.keepalive.mock.calls[0].arguments[0], options)
    stop()
    assert.equal(r.keepalive.mock.calls[0].result.mock.calls.length, 1)
    await browser.close()
  })

  it('rejects keepalive when the runner cannot renew its environment', async () => {
    const r = runner()
    delete r.keepalive
    const browser = createBrowserClient(r, { session: 's1' })

    assert.throws(() => browser.keepalive(), /does not support keepalive/)
    await browser.close()
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

  it('places client args before every command and close', async () => {
    const r = runner()
    const browser = createBrowserClient(r, {
      session: 's1',
      args: ['--color-scheme', 'dark', '--enable', 'react-devtools'],
    })

    await browser.exec('open', { args: ['https://example.com'] })
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session',
      's1',
      '--color-scheme',
      'dark',
      '--enable',
      'react-devtools',
      'open',
      'https://example.com',
    ])

    await browser.close()
    assert.deepEqual(r.run.mock.calls[1].arguments[1], [
      '--session',
      's1',
      '--color-scheme',
      'dark',
      '--enable',
      'react-devtools',
      'close',
    ])
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

  it('collects screenshots when value flags are present', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const result = await browser.exec('screenshot', {
      flags: { screenshotFormat: 'jpeg', screenshotQuality: 80 },
    })
    assert.equal(result.file.contentType, 'image/jpeg')
    assert.match(r.run.mock.calls[0].arguments[1].at(-1), /\.jpeg$/)
    await browser.close()
  })

  it('collects HAR and saved state output', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const har = await browser.exec('network', { args: ['har', 'stop'] })
    const state = await browser.exec('state', { args: ['save'] })

    assert.match(r.run.mock.calls[0].arguments[1].at(-1), /\.har$/)
    assert.equal(har.file.contentType, 'application/json')
    assert.match(r.run.mock.calls[1].arguments[1].at(-1), /\.json$/)
    assert.equal(state.file.contentType, 'application/json')
    await browser.close()
  })

  it('captures the recording path on start and reads it on stop', async () => {
    const r = runner()
    r.readFile.mock.mockImplementationOnce(async () => Buffer.from('video'))
    const browser = createBrowserClient(r, { session: 's1' })
    const started = await browser.exec('record', { args: ['start'] })
    const stopped = await browser.exec('record', { args: ['stop'] })

    const recordingPath = r.run.mock.calls[0].arguments[1].at(-1)
    assert.match(recordingPath, /^\/tmp\/agent-browser-.*\.webm$/)
    assert.equal(started.file, undefined)
    assert.deepEqual(r.run.mock.calls[1].arguments[1], [
      '--session', 's1', 'record', 'stop',
    ])
    assert.equal(r.readFile.mock.calls[0].arguments[0], recordingPath)
    assert.equal(stopped.file.contentType, 'video/webm')
    assert.deepEqual(stopped.file.bytes, Buffer.from('video'))
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

  it('adds --json and returns parsed command data', async () => {
    const r = runner()
    r.run.mock.mockImplementationOnce(async () => ({
      stdout: '{"success":true,"data":{"url":"https://example.com"}}',
      stderr: '',
      exitCode: 0,
    }))
    const browser = createBrowserClient(r, { session: 's1' })
    const result = await browser.exec('get', {
      args: ['url'],
      output: 'json',
    })

    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'get', 'url', '--json',
    ])
    assert.deepEqual(result.data, { url: 'https://example.com' })
    assert.equal(result.ok, true)
    assert.equal(
      result.stdout,
      '{"success":true,"data":{"url":"https://example.com"}}',
    )
    await browser.close()
  })

  it('reports invalid JSON with command context', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await assert.rejects(browser.exec('snapshot', { output: 'json' }), {
      name: 'SyntaxError',
      message: /agent-browser snapshot did not return valid JSON/,
    })
    await browser.close()
  })

  it('surfaces command failures before attempting to parse JSON', async () => {
    const r = runner()
    r.run.mock.mockImplementationOnce(async () => ({
      stdout: '',
      stderr: 'element not found',
      exitCode: 1,
    }))
    const browser = createBrowserClient(r, { session: 's1' })

    await assert.rejects(browser.exec('click', {
      args: ['@missing'],
      output: 'json',
    }), {
      name: 'Error',
      message: 'agent-browser click failed with exit code 1: element not found',
    })
    await browser.close()
  })

  it('rejects JSON without the agent-browser response envelope', async () => {
    const r = runner()
    r.run.mock.mockImplementationOnce(async () => ({
      stdout: '{"url":"https://example.com"}',
      stderr: '',
      exitCode: 0,
    }))
    const browser = createBrowserClient(r, { session: 's1' })

    await assert.rejects(browser.exec('get', {
      args: ['url'],
      output: 'json',
    }), {
      name: 'SyntaxError',
      message: /did not return a successful JSON envelope/,
    })
    await browser.close()
  })

  it('writes local buffers before uploading them', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    const bytes = Buffer.from('hello')
    await browser.upload('#avatar', [{ name: '../profile photo.png', bytes }])

    const [remotePath, writtenBytes] = r.writeFile.mock.calls[0].arguments
    assert.match(remotePath, /^\/tmp\/agent-browser-.*-profile-photo\.png$/)
    assert.deepEqual(writtenBytes, bytes)
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'upload', '#avatar', remotePath,
    ])
    await browser.close()
  })

  it('snapshots the current page without navigating', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.snapshot()
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'snapshot', '-i', '--json',
    ])
    await browser.close()
  })

  it('returns downloaded file bytes from the runner', async () => {
    const r = runner()
    r.readFile.mock.mockImplementationOnce(async () => Buffer.from('downloaded'))
    const browser = createBrowserClient(r, { session: 's1' })
    const { file, result } = await browser.download('#report', {
      filename: 'report.csv',
    })

    const args = r.run.mock.calls[0].arguments[1]
    assert.deepEqual(args.slice(0, 4), ['--session', 's1', 'download', '#report'])
    assert.match(args[4], /^\/tmp\/agent-browser-.*-report\.csv$/)
    assert.deepEqual(file.bytes, Buffer.from('downloaded'))
    assert.equal(file, result.file)
    await browser.close()
  })

  it('screenshots the current page with options as the first argument', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.screenshot({ fullPage: true })
    assert.deepEqual(r.run.mock.calls[0].arguments[1].slice(0, 4), [
      '--session', 's1', 'screenshot', '--full',
    ])
    assert.equal(r.run.mock.calls.length, 1)
    await browser.close()
  })

  it('still opens a URL before capturing when one is supplied', async () => {
    const r = runner()
    const browser = createBrowserClient(r, { session: 's1' })
    await browser.snapshot('https://example.com')
    assert.deepEqual(r.run.mock.calls[0].arguments[1], [
      '--session', 's1', 'open', 'https://example.com',
    ])
    assert.deepEqual(r.run.mock.calls[1].arguments[1], [
      '--session', 's1', 'snapshot', '-i', '--json',
    ])
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
  it('writes buffers through the sandbox file API', async () => {
    const sandbox = makeSandbox()
    const create = mock.method(Sandbox, 'create', async () => sandbox)

    try {
      const runner = await provisionBrowserSandbox({})
      const bytes = Buffer.from('upload')
      await runner.writeFile('/tmp/upload.txt', bytes)
      assert.deepEqual(sandbox.writes, [{ path: '/tmp/upload.txt', content: bytes }])
    } finally {
      create.mock.restore()
    }
  })

  it('creates an ephemeral sandbox from the default browser image', async () => {
    const sandbox = makeSandbox()
    const create = mock.method(Sandbox, 'create', async () => sandbox)

    try {
      const runner = await provisionBrowserSandbox({})
      assert.ok(runner)

      assert.equal(create.mock.calls.length, 1)
      const createOpts = create.mock.calls[0].arguments[0]
      assert.equal(createOpts.image, DEFAULT_BROWSER_IMAGE)
      assert.deepEqual(createOpts.resources, { vcpus: 2 })
      assert.equal(createOpts.persistent, false)
      assert.deepEqual(createOpts.ports, [])
      assert.match(createOpts.env.AGENT_BROWSER_ARGS, /--no-sandbox/)
      // Image provisioning needs no install or warm-up commands.
      assert.equal(sandbox.calls.length, 0)
    } finally {
      create.mock.restore()
    }
  })

  it('passes an explicit image, resources, timeout, and environment', async () => {
    const sandbox = makeSandbox()
    const create = mock.method(Sandbox, 'create', async () => sandbox)

    try {
      await provisionBrowserSandbox({
        image: 'browser@sha256:abc',
        vcpus: 4,
        timeoutMs: 123_000,
        env: { CUSTOM: 'yes' },
      })
      const createOpts = create.mock.calls[0].arguments[0]
      assert.equal(createOpts.image, 'browser@sha256:abc')
      assert.deepEqual(createOpts.resources, { vcpus: 4 })
      assert.equal(createOpts.timeout, 123_000)
      assert.equal(createOpts.env.CUSTOM, 'yes')
    } finally {
      create.mock.restore()
    }
  })
})
