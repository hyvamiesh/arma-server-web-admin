import React, { Component } from 'react'
import { Badge, Table } from 'reactstrap'
import { Link } from 'react-router-dom'

import ServersContext from '../contexts/Servers'

export default class Servers extends Component {
  renderRow (server) {
    return (
      <tr key={server.id}>
        <td>{this.renderStatus(server)}</td>
        <td>{server.port}</td>
        <td><Link to={`/servers/${server.id}`}>{server.title}</Link></td>
      </tr>
    )
  }

  renderStatus (server) {
    if (server.pid) {
      if (server.state) {
        return <Badge color='success'>Online</Badge>
      }

      return <Badge color='info'>Launching</Badge>
    }

    return <Badge color='secondary'>Offline</Badge>
  }

  render () {
    return (
      <Table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Port</th>
            <th>Title</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <ServersContext.Consumer>
            {servers => (
              servers.map(server => this.renderRow(server))
            )}
          </ServersContext.Consumer>
        </tbody>
      </Table>
    )
  }
}
