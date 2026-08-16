import { clientBundle } from './build/client-bundle.ts'

export default clientBundle('dsh-network-settings', 'src/host/index.ts', 'src/client/index.ts', {
  externals: [
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-settings-plugins',
    '@deepseek-ai/dsh-client-locale',
  ],
})
