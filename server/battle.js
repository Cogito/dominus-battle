Battle = {
	// if no battle exists in this hex create one
	start_battle: function(x,y) {
		if (Battles.find({x:x,y:y}).count() == 0) {
			Battle.run_battle(x,y)
		}
	},

	// battle controller
	run_battle: function(x,y) {
		var battle = new Fight(x,y)

		// gather info, compute power
		battle.findDefender()
		battle.findAttackers()
		if (battle.numPartiesInBattle < 2) {
			battle.isOver = true
			battle.endBattle()
		} else {
			battle.setAllArmyInfo()
			battle.findAllEnemies()
			battle.setAllEnemyInfo()
			battle.dividePowerByNumEnemies_all()
			battle.computeAllBonuses()
			battle.setLocationBonus()
			battle.computeFinalPower_all()

			// all info gathered, do battle!
			battle.fight_all()
			battle.findSurvivors_all()

			// save
			battle.save_all()
			battle.isBattleOver()
			battle.endBattle()
		}
	}
}




Fight = function(x, y) {
	this.x = x
	this.y = y

	// get battle here
	this.battle = Battles.findOne({x:x, y:y})

	// if there is no battle here then create one
	if (!this.battle) {
		this.battle = {
			x:x,
			y:y,
			created_at:new Date(),
			updated_at:new Date(),
			roundNumber: 0
		}
		this.battle._id = Battles.insert(this.battle)
	}

	this.isOver = false
	this.numPartiesInBattle = 0	// used to tell if battle is over

	var castle_fields = {name:1, user_id:1, x:1, y:1, username:1, image:1}
	var army_fields = {name:1, user_id:1, x:1, y:1, last_move_at:1, username:1, castle_x:1, castle_y:1, castle_id:1}
	var village_fields = {name:1, user_id:1, x:1, y:1, username:1, castle_x:1, castle_y:1, castle_id:1}

	_.each(s.army.types, function(type) {
		castle_fields[type] = 1
		army_fields[type] = 1
		village_fields[type] = 1
	})

	this.armies = Armies.find({x:x, y:y}, {fields: army_fields})
	this.castle = Castles.findOne({x:x, y:y}, {fields: castle_fields})
	this.village = Villages.findOne({x:x, y:y}, {fields: village_fields})



	// there is always one defender
	// if there is a castle or village then they are the defender
	// otherwise it's the army who arrived first and is still alive
	this.findDefender = function() {
		if (this.castle) {
			this.defender = this.castle
			this.defender.type = 'castle'
		} else if (this.village) {
			this.defender = this.village
			this.defender.type = 'village'
		} else {
			this.defender = this.findArmyThatArrivedFirst()
			this.defender.type = 'army'
		}

		if (this.defender) {
			this.defender.isAttacker = false
			this.numPartiesInBattle++
		}
	}

	// used in findDefender
	this.findArmyThatArrivedFirst = function() {
		var oldest_date = moment(new Date()).add(1, 'years')
		var firstArmy = null

		this.armies.forEach(function(army) {
			var last_move_at = moment(new Date(army.last_move_at))
			if (last_move_at.isBefore(oldest_date)) {
				oldest_date = last_move_at
				firstArmy = army
			}
		})

		return firstArmy
	}



	// everyone who is not a defender is an attacker
	// findDefender must be called before findAttackers
	this.findAttackers = function() {
		var self = this
		check(self.defender._id, String)
		self.attackers = []
		self.armies.forEach(function(army) {
			if (army._id != self.defender._id) {
				army.type = 'army'
				army.isAttacker = true
				self.attackers.push(army)
				self.numPartiesInBattle++
			}
		})
	}



	// run findEnemies on everyone
	this.findAllEnemies = function() {
		var self = this
		self.findEnemies(self.defender)
		_.each(self.attackers, function(attacker) {
			self.findEnemies(attacker)
		})
	}

	// loop through all units and find if they're an enemy
	this.findEnemies = function(unit) {
		check(unit, Object)
		var self = this
		unit.enemies = []

		if (self.defender._id != unit._id) {
			if (self.isEnemy(unit, self.defender)) {
				unit.enemies.push(self.defender)
			}
		}

		_.each(self.attackers, function(attacker) {
			if (attacker._id != unit._id) {
				if (self.isEnemy(unit, attacker)) {
					unit.enemies.push(attacker)
				}
			}
		})
	}

	// figure out if they're an enemy based on their relationship to unit
	this.isEnemy = function(unit, otherUnit) {
		check(unit, Object)
		check(otherUnit, Object)
		var isEnemy = false
		var user = Meteor.users.findOne(unit.user_id, {fields: {allies:1, team:1, allies_below:1}})

		switch (unit.type) {
			case 'castle':
				if (_.indexOf(user.team, unit.user_id) != -1) {
					if (_.indexOf(user.allies_below, unit.user_id) != -1) { } else {
						isEnemy = true
					}
				} else {
					isEnemy = true
				}
				break

			case 'village':
			case 'army':
				if (_.indexOf(user.allies, unit.user_id) != -1) { } else {
					isEnemy = true
				}
				break
		}

		return isEnemy
	}



	// set power and number of units in the army
	this.setAllArmyInfo = function() {
		var self = this
		self.setArmyInfo(self.defender)
		_.each(self.attackers, function(attacker) {
			self.setArmyInfo(attacker)
		})
	}

	this.setArmyInfo = function(unit) {
		unit.base_power = {total:0}
		unit.num_units = 0

		if (unit.isAttacker) {
			_.each(s.army.types, function(type) {
				unit.base_power[type] = s.army.stats[type].offense * unit[type]
				unit.base_power.total += s.army.stats[type].offense * unit[type]
				unit.num_units += unit[type]
			})
		} else {
			_.each(s.army.types, function(type) {
				unit.base_power[type] = s.army.stats[type].defense * unit[type]
				unit.base_power.total += s.army.stats[type].defense * unit[type]
				unit.num_units += unit[type]
			})
		}

		// percentage
		// for each unit, what percentage of the army are they
		unit.percentage = {}
		_.each(s.army.types, function(type) {
			if (unit[type] == 0) {
				unit.percentage[type] = 0
			} else {
				unit.percentage[type] = unit[type] / unit.num_units
			}
		})
	}



	// loop through enemies and gather power and number of units
	this.setAllEnemyInfo = function() {
		var self = this
		self.getEnemyInfo(self.defender)
		_.each(self.attackers, function(attacker) {
			self.getEnemyInfo(attacker)
		})
	}

	this.getEnemyInfo = function(unit) {
		unit.enemy_base_power = {total:0}
		unit.enemy_num_units = {total:0}
		_.each(s.army.types, function(type) {
			unit.enemy_num_units[type] = 0
		})

		_.each(unit.enemies, function(enemy) {
			// divide power by number of enemies
			var num_enemies = enemy.enemies.length
			check(num_enemies, Number)

			_.each(s.army.types, function(type) {
				if (enemy.isAttacker) {
					unit.enemy_base_power[type] = s.army.stats[type].offense * enemy[type] / num_enemies
					unit.enemy_base_power.total += s.army.stats[type].offense * enemy[type] / num_enemies
					unit.enemy_num_units[type] += enemy[type]
					unit.enemy_num_units.total += enemy[type]
				} else {
					unit.enemy_base_power[type] = s.army.stats[type].defense * enemy[type] / num_enemies
					unit.enemy_base_power.total += s.army.stats[type].defense * enemy[type] / num_enemies
					unit.enemy_num_units[type] += enemy[type]
					unit.enemy_num_units.total += enemy[type]
				}
				
			})
		})

		// percentage
		unit.enemy_percentage = {}
		_.each(s.army.types, function(type) {
			if (unit.enemy_num_units[type] == 0) {
				unit.enemy_percentage[type] = 0
			} else {
				unit.enemy_percentage[type] = unit.enemy_num_units[type] / unit.enemy_num_units.total
			}
		})
	}



	// if there is more than one enemy then army gets split by number of enemies
	// this is already done for enemies
	this.dividePowerByNumEnemies_all = function() {
		var self = this
		self.dividePowerByNumEnemies(self.defender)
		_.each(self.attackers, function(attacker) {
			self.dividePowerByNumEnemies(attacker)
		})
	}

	this.dividePowerByNumEnemies = function(unit) {
		check(unit.enemies, Array)
		var num_enemies = unit.enemies.length
		check(num_enemies, Number)
		unit.base_power.total = unit.base_power.total / num_enemies
		_.each(s.army.types, function(type) {
			unit.base_power[type] = unit.base_power[type] / num_enemies
		})
	}



	this.computeAllBonuses = function() {
		var self = this
		self.computeBonus(self.defender)
		_.each(self.attackers, function(attacker) {
			self.computeBonus(attacker)
		})
	}

	this.computeBonus = function(unit) {
		var self = this

		// my bonus
		unit.bonus = {}
		unit.bonus.footmen = 0
		unit.bonus.archers = unit.base_power.archers * unit.percentage.archers * unit.enemy_percentage.footmen
		unit.bonus.pikemen = unit.base_power.pikemen * unit.percentage.pikemen * unit.enemy_percentage.cavalry
		unit.bonus.cavalry = unit.base_power.cavalry * unit.percentage.cavalry * (unit.enemy_percentage.archers + unit.enemy_percentage.footmen)
		unit.bonus.catapults = 0

		// my catapults
		if (unit.isAttacker) {
			if (self.defender.type == 'castle' || self.defender.type == 'village') {
				unit.bonus.catapults = unit.base_power.catapults * s.army.stats.catapults.bonus_against_buildings
			}
		}

		// my total bonus
		unit.bonus.total = 0
		_.each(s.army.types, function(type) {
			unit.bonus.total += unit.bonus[type]
		})

		// enemy bonus
		unit.enemy_bonus = {}
		unit.enemy_bonus.footmen = 0
		unit.enemy_bonus.archers = unit.enemy_base_power.archers * unit.enemy_percentage.archers * unit.percentage.footmen
		unit.enemy_bonus.pikemen = unit.enemy_base_power.pikemen * unit.enemy_percentage.pikemen * unit.percentage.cavalry
		unit.enemy_bonus.cavalry = unit.enemy_base_power.cavalry * unit.enemy_percentage.cavalry * (unit.percentage.archers + unit.percentage.footmen)
		unit.enemy_bonus.catapults = 0

		// enemy catapults
		if (unit.type == 'castle' || unit.type == 'village') {
			if (unit.enemy_num_units.catapults > 0) {
				unit.enemy_bonus.catapults = unit.enemy_num_units.catapults * s.army.stats.catapults.bonus_against_buildings
			}
		}

		// enemy total bonus
		unit.enemy_bonus.total = 0
		_.each(s.army.types, function(type) {
			unit.enemy_bonus.total += unit.enemy_bonus[type]
		})
	}



	// power + bonus
	this.computeFinalPower_all = function() {
		var self = this
		self.computeFinalPower(self.defender)
		_.each(self.attackers, function(attacker) {
			self.computeFinalPower(attacker)
		})
	}

	this.computeFinalPower = function(unit) {
		unit.final_power = unit.base_power.total + unit.bonus.total
		unit.enemy_final_power = unit.enemy_base_power.total + unit.enemy_bonus.total
	}



	// bonus for being inside a castle/village or on allied castle/village
	this.setLocationBonus = function() {
		var self = this

		if (self.defender.type == 'castle') {
			self.defender.final_power = self.defender.final_power * s.castle.defense_bonus
		}

		if (self.defender.type == 'village') {
			self.defender.final_power = self.defender.final_power * s.village.defense_bonus
		}

		self.setOnAllyCastleOrVillageBonus(self.defender)
		_.each(self.attackers, function(attacker) {
			self.setOnAllyCastleOrVillageBonus(attacker)
		})
	}

	this.setOnAllyCastleOrVillageBonus = function(unit) {
		check(unit.user_id, String)
		var user = Meteor.users.findOne(unit.user_id, {fields: {allies: 1, allies_below:1}})
		if (user) {
			check(user.allies_below, Array)
			if (user.allies_below.length > 0) {
				if (Castles.find({x: unit.x, y: unit.y, user_id: {$in: user.allies_below}}).count() > 0) {
					unit.final_power = unit.final_power * s.castle.ally_defense_bonus
				}
			}

			check(user.allies, Array)
			if (user.allies.length > 0) {
				if (Villages.find({x: unit.x, y: unit.y, user_id: {$in: user.allies}}).count() > 0) {
					unit.final_power = unit.final_power * s.village.ally_defense_bonus
				}
			}
		}
	}



	// find who won
	this.fight_all = function() {
		var self = this
		self.fight(self.defender)
		_.each(self.attackers, function(attacker) {
			self.fight(attacker)
		})
	}

	this.fight = function(unit) {
		unit.dif = unit.final_power - unit.enemy_final_power
	}
	


	// pick who died randomly
	this.findSurvivors_all = function() {
		var self = this
		self.findSurvivors(self.defender)
		_.each(self.attackers, function(attacker) {
			self.findSurvivors(attacker)
		})
	}

	this.findSurvivors = function(unit) {
		var self = this
		unit.survivors = {}

		// set survivors to unit's current units
		_.each(s.army.types, function(type) {
			unit.survivors[type] = unit[type]
		})

		// if army wins then number dead is reduced
		if (self.dif > 0) {
			var num_dead = s.battle_dead_per_round_win
		} else {
			var num_dead = s.battle_dead_per_round_lose
		}

		// loop, take away at random until all dead are taken
		var i = 0
		var units_left = unit.num_units
		while (i < num_dead) {
			var rand = Math.floor(Math.random() * s.army.types.length)
			var type = s.army.types[rand]
			check(unit.survivors[type], Number)

			if (unit.survivors[type] > 0) {
				unit.survivors[type]--
				i++
				units_left--
			}

			// stop if everyone is dead
			if (units_left == 0) {
				i = num_dead
			}
		}

		// total survivors
		unit.survivors.total = 0
		_.each(s.army.types, function(type) {
			unit.survivors.total += unit.survivors[type]
		})
	}



	// save to db
	this.save_all = function() {
		var self = this

		self.save(self.defender)
		_.each(self.attackers, function(attacker) {
			self.save(attacker)
		})
	}

	// used in save() to find who to give castle to
	// must be called after findSurvivors()
	this.findAttackerThatIsStillAliveAndArrivedFirst = function() {
		var self = this
		var oldest_date = moment(new Date()).add(1, 'years')
		var firstArmy = null

		_.each(self.attackers, function(army) {
			check(army.survivors.total, Number)
			if (army.survivors.total > 0) {
				var last_move_at = moment(new Date(army.last_move_at))
				if (last_move_at.isBefore(oldest_date)) {
					oldest_date = last_move_at
					firstArmy = army
				}
			}
		})

		if (firstArmy) {
			return firstArmy
		} else {
			return false
		}
	}

	this.save = function(unit) {
		var self = this

		var set = {}
		_.each(s.army.types, function(type) {
			set[type] = unit.survivors[type]
		})

		switch (unit.type) {
			case 'army':
				if (unit.survivors.total > 0) {
					// remove dead from army
					Armies.update(unit._id, {$set: set})
				} else {
					// army is destroyed
					sendNotification(unit.user_id, self)
					Armies.remove(unit._id)
					self.numPartiesInBattle--
				}
				break

			case 'village':
				if (unit.survivors.total > 0) {
					// remove dead
					Villages.update(unit._id, {$set: set})
				} else {
					// destroy village
					sendNotification(unit.user_id, self)
					Villages.remove(unit._id)
					self.numPartiesInBattle--
				}
				break

			case 'castle':
				Castles.update(unit._id, {$set: set})
				if (unit.survivors.total == 0) {
					sendNotification(unit.user_id, self)
					self.numPartiesInBattle--

					var firstArmy = self.findAttackerThatIsStillAliveAndArrivedFirst()
					if (firstArmy) {
						var lord = Meteor.users.findOne(firstArmy.user_id)
						var vassal = Meteor.users.findOne(unit.user_id)
						if (lord && vassal) {
							set_lord_and_vassal(lord, vassal)
						}
					}
					
				}
				break
		}
	}



	this.isBattleOver = function() {
		var self = this
		var someoneHasAnEnemy = false 	// if someone has an enemy then battle is not over
		var peopleStillAlive = []	// who should we send a notification to if battle is over

		// check if defender is still alive and their enemies are still alive
		if (self.defender.survivors.total > 0) {
			peopleStillAlive.push(self.defender)
			_.each(self.defender.enemies, function(enemy) {
				if (enemy.survivors.total > 0) {
					someoneHasAnEnemy = true
				}
			})
		}

		// check attackers
		_.each(self.attackers, function(attacker) {
			if (attacker.survivors.total > 0) {
				peopleStillAlive.push(attacker)
				_.each(attacker.enemies, function(enemy) {
					if (enemy.survivors.total > 0) {
						someoneHasAnEnemy = true
					}
				})
			}
		})

		if (!someoneHasAnEnemy) {
			self.isOver = true

			// send notification to surviving people
			_.each(peopleStillAlive, function(u) {
				sendNotification(u.user_id, self)
			})
		}
	}



	// is the battle over
	this.endBattle = function() {
		if (this.isOver) {
			Battles.remove(this.battle._id)
		} else {

			var set = {
				updated_at: new Date(),
				numPartiesInBattle: this.numPartiesInBattle,
				defender: limitObjectDepth(this.defender, 4),
				attackers: limitObjectDepth(this.attackers, 5),
			}

			var inc = {
				roundNumber:1
			}

			Battles.update(this.battle._id, {$set: set, $inc: inc})
		}
	}
}


function sendNotification(user_id, self) {
	var data = prepareDataForNotification(self)
	notification_battle(user_id, data)
}

function prepareDataForNotification(self) {
	var data = {
		created_at: new Date(),
		battle: self.battle,
		isOver: self.isOver,
		roundNumber: self.roundNumber,
		numPartiesInBattle: self.numPartiesInBattle,
		defender: limitObjectDepth(self.defender, 4),
		attackers: limitObjectDepth(self.attackers, 5),
	}
	return data
}



limitObjectDepth = function(input, maxDepth) {

	function recursion(input, level) {

		if (level > maxDepth) {
			return null
		} else {

			if (_.isArray(input)) {
				var arr = []
				_.each(input, function(col) {
					arr.push(recursion(col, level+1))
				})
				return arr

			} else if (_.isObject(input)) {
				var obj = {}
				_.each(input, function(value, key) {
					obj[key] = recursion(value, level+1)
				})
				return obj

			} else {
				return input
			}

		}
	}

	return recursion(input, 1)
}