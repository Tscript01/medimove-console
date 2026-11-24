import { Router } from 'express'
import * as swaggerUi from 'swagger-ui-express'

import { apiDocsEnabled } from '../config/env'
import { openapi } from '../docs/openapi'

/**
 * Interactive API documentation.
 *
 *   GET /api/docs               -> Swagger UI (interactive, "Try it out")
 *   GET /api/docs/openapi.json  -> the raw OpenAPI 3.1 document
 *
 * Disabled in production unless `API_DOCS_ENABLED=true`, so an internal API
 * surface is not exposed publicly by default. The spec is compiled from
 * `src/docs/openapi.ts` (generated from `docs/API.md`), so it ships inside
 * `dist/` and needs no filesystem reads at runtime.
 */

const router = Router()

if (apiDocsEnabled) {
  // Swagger UI is an HTML page that loads its own JS/CSS from this same origin.
  // helmet's JSON-API CSP would block it, so relax the policy for the docs path
  // only — the rest of the API keeps the strict default.
  router.use('/docs', (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
    )
    next()
  })

  // Raw spec (also handy for Postman/Insomnia/Redoc/codegen).
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(openapi)
  })

  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapi, {
      customSiteTitle: 'MediMove API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' }
    })
  )
}

export default router
