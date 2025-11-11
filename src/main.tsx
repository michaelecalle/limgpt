import "./lib/ftParser"
// tout en haut (dev uniquement)
import "./lib/setTitleFromTrain"
// import "./lib/limDebugClient" // désactivé temporairement pour supprimer l'affichage FT de debug
import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { APP_VERSION } from "./components/version";
console.log(`[LIMGPT ${APP_VERSION}] démarre`);


// ✅ Import unique pour initialiser l’écoute du bouton "Importer PDF"
import './lib/limParser'

import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
