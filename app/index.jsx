import 'bootstrap/dist/css/bootstrap.css'
import React from 'react'
import { render } from 'react-dom'
import { BrowserRouter, Redirect, Route, Switch } from 'react-router-dom'
import App from './App.jsx'
import Missions from './pages/Missions.jsx'
import Mods from './pages/Mods.jsx'
import Server from './pages/Server.jsx'
import Servers from './pages/Servers.jsx'

render((
  <BrowserRouter>
    <App>
      <Switch>
        <Route exact path='/missions' component={Missions} />
        <Route exact path='/mods' component={Mods} />
        <Route exact path='/servers' component={Servers} />
        <Route exact path='/servers/:id' component={Server} />
        <Redirect path='*' to='/servers' />
      </Switch>
    </App>
  </BrowserRouter>
), document.getElementById('content'))
