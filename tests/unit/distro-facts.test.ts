import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDistroFacts, parseWslStatus, parseWslVersion } from '../../src/host/wsl/inspect.ts'
import { classifyInterface } from '../../src/host/windows/inspect.ts'

const FACTS = `---CAPS---
PROC=1
OSRELEASE=1
RESOLVCONF=1
WSLCONF=1
CMD_sh=1
CMD_cat=1
CMD_ip=1
CMD_getent=0
CMD_curl=1
CMD_wget=0
CMD_python3=1
CMD_python=0
---OSRELEASE---
PRETTY_NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.19.1
---RESOLVCONF---
nameserver 10.255.255.254
---ROUTE---
default via 172.30.96.1 dev eth0
---WSLCONF---
[network]
generateResolvConf = false
---ENV---
HTTPS_PROXY=http://127.0.0.1:7890
no_proxy=localhost
---DONE---
`

describe('WSL distro probe parser', () => {
  it('parses capability markers, os-release, route and proxy env', () => {
    const facts = parseDistroFacts(FACTS)
    assert.equal(facts.osMetadata.id, 'alpine')
    assert.equal(facts.capabilities.commands.python3, true)
    assert.equal(facts.capabilities.commands.getent, false)
    assert.deepEqual(facts.resolvNameservers, ['10.255.255.254'])
    assert.equal(facts.defaultRoute, '172.30.96.1')
    assert.equal(facts.environment.HTTPS_PROXY, 'http://127.0.0.1:7890')
    assert.equal(facts.wslConf?.network?.generateResolvConf, false)
  })

  it('parses wsl --version and --status in localized text', () => {
    const version = parseWslVersion('WSL 版本: 2.7.10.0\n内核版本: 6.18.33.2-2\nWindows: 10.0.26100.4946\n')
    assert.equal(version?.wslVersion, '2.7.10.0')
    assert.equal(version?.windowsVersion, '10.0.26100.4946')
    const status = parseWslStatus('默认分发: docker-desktop\n默认版本: 2\n', [{ name: 'docker-desktop', state: 'stopped', wslVersion: 2, default: true }])
    assert.equal(status.defaultDistribution, 'docker-desktop')
    assert.equal(status.defaultVersion, 2)
  })

  it('classifies interface kinds from vendor descriptions, not localized names', () => {
    assert.equal(classifyInterface('Intel(R) Wi-Fi 6 AX201 160MHz'), 'wi-fi')
    assert.equal(classifyInterface('Tailscale Tunnel'), 'tailscale')
    assert.equal(classifyInterface('VMware Virtual Ethernet Adapter for VMnet8'), 'vmware')
    assert.equal(classifyInterface('Hyper-V Virtual Ethernet Adapter'), 'hyper-v')
    assert.equal(classifyInterface('Realtek PCIe GbE Family Controller'), 'ethernet')
  })
})
