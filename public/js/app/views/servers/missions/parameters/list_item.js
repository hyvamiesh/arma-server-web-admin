var $ = require('jquery')
var _ = require('underscore')
var Marionette = require('marionette')

var tpl = require('tpl/servers/missions/parameters/list_item.html')

var template = _.template(tpl)

module.exports = Marionette.ItemView.extend({
  tagName: 'tr',
  template: template,

  events: {
    'click button.parameter-delete': 'delete',
    'change input#parameter-name': 'changed',
    'change input#parameter-value': 'changed'
  },

  changed: function (e) {
    var val = $(e.target).val()
    this.model.set(e.target.id, val)
  },

  delete: function (e) {
    e.preventDefault()
    this.model.destroy()
  }
})
