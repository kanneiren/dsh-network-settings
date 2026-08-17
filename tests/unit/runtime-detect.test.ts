import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectRuntime, parseOsRelease, wslVersionFromKernel } from '../../src/host/network/runtime.ts'

describe('runtime detection', () => {
  it('detects Windows native', () => {
    const runtime = detectRuntime({ platform: 'win32', env: { OS: 'Windows_NT' } })
    assert.equal(runtime.type, 'WINDOWS_NATIVE')
    if (runtime.type === 'WINDOWS_NATIVE') assert.equal(runtime.confidence, 'verified')
  })

  it('detects WSL Ubuntu with registered name from WSL_DISTRO_NAME', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      procVersion: 'Linux version 6.18.33.2-microsoft-standard-WSL2',
      osRelease: 'PRETTY_NAME="Ubuntu 24.04.4 LTS"\nID=ubuntu\nVERSION_ID=24.04\n',
      cgroup: '0::/init.scope',
      interopAvailable: true,
    })
    assert.equal(runtime.type, 'WSL_DISTRIBUTION')
    if (runtime.type === 'WSL_DISTRIBUTION') {
      assert.equal(runtime.registeredName, 'Ubuntu-24.04')
      assert.equal(runtime.displayName, 'Ubuntu 24.04.4 LTS')
      assert.equal(runtime.wslVersion, 2)
      assert.equal(runtime.confidence, 'verified')
    }
  })

  it('detects WSL Arch from os-release and WSL2 kernel', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Arch' },
      procVersion: 'Linux version 6.6-microsoft-standard-WSL2',
      osRelease: 'PRETTY_NAME="Arch Linux"\nID=arch\n',
      cgroup: '',
      interopAvailable: false,
    })
    assert.equal(runtime.type, 'WSL_DISTRIBUTION')
    if (runtime.type === 'WSL_DISTRIBUTION') assert.equal(runtime.linux.id, 'arch')
  })

  it('keeps custom --import registered name and does not derive it from os-release ID', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'MyDevEnvironment' },
      procVersion: 'Linux version 5.15-microsoft-standard-WSL2',
      osRelease: 'PRETTY_NAME="Ubuntu 22.04.2 LTS"\nID=ubuntu\nVERSION_ID=22.04\n',
      cgroup: '',
      interopAvailable: true,
    })
    assert.equal(runtime.type, 'WSL_DISTRIBUTION')
    if (runtime.type === 'WSL_DISTRIBUTION') {
      assert.equal(runtime.registeredName, 'MyDevEnvironment')
      assert.equal(runtime.displayName, 'Ubuntu 22.04.2 LTS')
    }
  })

  it('classifies Linux but NOT WSL as unsupported', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: {},
      procVersion: 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-123)',
      osRelease: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n',
      cgroup: '0::/user.slice',
      interopAvailable: false,
    })
    assert.equal(runtime.type, 'UNSUPPORTED_RUNTIME')
    if (runtime.type === 'UNSUPPORTED_RUNTIME') assert.equal(runtime.reason, 'LINUX_NOT_WSL')
  })

  it('detects WSL even when interop is disabled', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      procVersion: 'Linux version 6.18.33.2-microsoft-standard-WSL2',
      osRelease: 'ID=ubuntu\n',
      cgroup: '',
      interopAvailable: false,
    })
    assert.equal(runtime.type, 'WSL_DISTRIBUTION')
  })

  it('does not misclassify a Docker container running on WSL', () => {
    const runtime = detectRuntime({
      platform: 'linux',
      env: {},
      procVersion: 'Linux version 6.18.33.2-microsoft-standard-WSL2',
      osRelease: 'ID=alpine\n',
      cgroup: '0::/system.slice/docker-abc.scope',
      interopAvailable: false,
    })
    assert.equal(runtime.type, 'UNSUPPORTED_RUNTIME')
    if (runtime.type === 'UNSUPPORTED_RUNTIME') assert.equal(runtime.reason, 'LINUX_CONTAINER_ON_WSL')
  })

  it('recognizes WSL1 kernel signature', () => {
    assert.equal(wslVersionFromKernel('Linux version 4.4.0-19041-Microsoft'), 1)
  })

  it('parses os-release metadata', () => {
    const metadata = parseOsRelease('PRETTY_NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.19.1\nVERSION_CODENAME=foo\n')
    assert.equal(metadata.prettyName, 'Alpine Linux')
    assert.equal(metadata.id, 'alpine')
    assert.equal(metadata.versionId, '3.19.1')
  })
})
