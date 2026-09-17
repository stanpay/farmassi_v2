import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { epostDevProxy } from './vite.epostDevProxy'

const SW_COMMIT_PLACEHOLDER = '__GIT_COMMIT__'

function gitCommitHash() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

function injectSwGitHash(): Plugin {
  const hash = gitCommitHash()
  return {
    name: 'inject-sw-git-hash',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/sw.js') {
          next()
          return
        }
        const source = readFileSync(path.resolve('public/sw.js'), 'utf8')
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(source.replaceAll(SW_COMMIT_PLACEHOLDER, hash))
      })
    },
    writeBundle(options) {
      const swPath = path.join(options.dir ?? 'dist', 'sw.js')
      const source = readFileSync(swPath, 'utf8')
      writeFileSync(swPath, source.replaceAll(SW_COMMIT_PLACEHOLDER, hash))
    },
  }
}

export default defineConfig({
  // 화면에 지금 배포된 프론트가 무엇인지 보여주기 위한 값.
  // 커밋 해시는 Vercel 빌드에서는 VERCEL_GIT_COMMIT_SHA 로, 로컬에서는 git 에서 온다.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommitHash()),
  },
  plugins: [react(), tailwindcss(), injectSwGitHash(), epostDevProxy()],
  base: '/',
  server: {
    port: 5173,
    strictPort: true,
  },
})
