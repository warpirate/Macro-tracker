import '@fontsource-variable/fraunces'
import '@fontsource-variable/figtree'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { configureFoodApis } from './utils/foodApiConfig'
import './index.css'

/*
  Platform values for the shared food-search code, supplied before anything can search.

  `src/utils` is vendored verbatim into the mobile app, which runs it under Metro where
  `import.meta` does not exist — so the read has to happen here, in a file only the web
  build ever loads, rather than inside the module that needs the value. The mobile app makes
  the equivalent call from its own entry point.
*/
configureFoodApis({
  usdaApiKey: import.meta.env.VITE_USDA_API_KEY,
  userAgent: 'MacroFit Web - https://github.com/warpirate/macrofit-mobile',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
