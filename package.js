Package.describe({
	name: "danimal:dominus-battle",
	summary: " Battle package for Dominus.  http://dominusgame.net",
	version: "1.0.0",
	git: " \* Fill me in! *\ "
})

Package.onUse(function(api) {
	api.versionsFrom('METEOR-CORE@0.9.0-rc11')
	api.use(['templating', 'deps'], 'client')
	api.export('Battle', 'server')
	api.addFiles('server/battle.js', 'server')
	api.addFiles('server/battle_job.js', 'server')
	api.addFiles('server/publish.js', 'server')
	api.addFiles('client/battle_report.html', 'client')
	api.addFiles('client/battle_report.js', 'client')
})
