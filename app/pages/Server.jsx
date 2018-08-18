import React, { Component } from 'react'

import ServersContext from '../contexts/Servers'

export default class Server extends Component {
  renderServer (server) {
    return server.title
  }

  renderNotFound () {
    return 'Not Found'
  }

  render () {
    const serverId = this.props.match.params.id

    return (
      <ServersContext.Consumer>
        {servers => {
          const server = servers.find(server => server.id === serverId)

          if (server) {
            return this.renderServer(server)
          }

          return this.renderNotFound()
        }}
      </ServersContext.Consumer>
    )
  }
}
