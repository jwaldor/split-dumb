import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Home from './pages/Home.jsx'
import TabView from './pages/TabView.jsx'
import PluginInfo from './pages/PluginInfo.jsx'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/t/:id', element: <TabView /> },
  { path: '/plugin', element: <PluginInfo /> },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
