Template.battle_report_unit.helpers({
	greater_than_zero: function(num) {
		if (num > 0) {
			return true
		} else {
			return false
		}
	},

	unit_type: function(name) {
		if (this.type == name) {
			return true
		}
		return false
	},

	castle_defense_bonus: function() {
		return s.castle.defense_bonus
	},

	village_defense_bonus: function() {
		return s.village.defense_bonus
	},
})

Template.battle_report.helpers({
	next_fight_in: function() {
		Session.get('refresh_time_field')
		return moment(new Date(this.updated_at)).add(s.battle_interval, 'ms').fromNow()
	}
})

Template.battle_report.events({
	'click .battle_report_goto_user': function(event, template) {
		Session.set('selected_type', 'castle')

		if (this.type == 'castle') {
			center_on_hex(this.x, this.y)
			Session.set('selected_id', this._id)
		} else {
			center_on_hex(this.castle_x, this.castle_y)
			Session.set('selected_id', this.castle_id)
		}
	},
})