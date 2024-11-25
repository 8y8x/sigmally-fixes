// ==UserScript==
// @name         Sigmally Fixes V2
// @version      2.4.0
// @description  Easily 3X your FPS on Sigmally.com + many bug fixes + great for multiboxing + supports SigMod
// @author       8y8x
// @match        https://*.sigmally.com/*
// @license      MIT
// @grant        none
// @namespace    https://8y8x.dev/sigmally-fixes
// @compatible   chrome Recommended for all users, works perfectly out of the box
// ==/UserScript==

// @ts-check
/* eslint
	camelcase: 'error',
	comma-dangle: ['error', 'always-multiline'],
	indent: ['error', 'tab', { SwitchCase: 1 }],
	max-len: ['error', { code: 120 }],
	no-console: ['error', { allow: ['warn', 'error'] }],
	no-trailing-spaces: 'error',
	quotes: ['error', 'single'],
	semi: 'error',
*/ // a light eslint configuration that doesn't compromise code quality
'use strict';

(async () => {
	const sfVersion = '2.4.0';
	// yes, this actually makes a significant difference
	const undefined = window.undefined;

	////////////////////////////////
	// Define Auxiliary Functions //
	////////////////////////////////
	const aux = (() => {
		const aux = {};

		/** @type {Map<string, string>} */
		aux.clans = new Map();
		function fetchClans() {
			fetch('https://sigmally.com/api/clans').then(r => r.json()).then(r => {
				if (r.status !== 'success') {
					setTimeout(() => fetchClans(), 10_000);
					return;
				}

				aux.clans.clear();
				r.data.forEach(clan => {
					if (typeof clan._id !== 'string' || typeof clan.name !== 'string') return;
					aux.clans.set(clan._id, clan.name);
				});
			});
		}
		fetchClans();

		/**
		 * @template T
		 * @param {T} x
		 * @param {string} err should be readable and easily translatable
		 * @returns {T extends (null | undefined | false | 0) ? never : T}
		 */
		aux.require = (x, err) => {
			if (!x) {
				err = '[Sigmally Fixes]: ' + err;
				prompt(err, err); // use prompt, so people can paste the error message into google translate
				throw err;
			}

			return /** @type {any} */ (x);
		};

		/**
		 * consistent exponential easing relative to 60fps.
		 * for example, with a factor of 2, o=0, n=1:
		 * - at 60fps, 0.5 is returned.
		 * - at 30fps (after 2 frames), 0.75 is returned.
		 * - at 15fps (after 4 frames), 0.875 is returned.
		 * - at 120fps, 0.292893 is returned. if you called this again with o=0.292893, n=1, you would get 0.5.
		 *
		 * @param {number} o
		 * @param {number} n
		 * @param {number} factor
		 * @param {number} dt in seconds
		 */
		aux.exponentialEase = (o, n, factor, dt) => {
			return o + (n - o) * (1 - (1 - 1 / factor) ** (60 * dt));
		};

		/**
		 * @param {string} hex
		 * @returns {[number, number, number, number]}
		 */
		aux.hex2rgba = hex => {
			switch (hex.length) {
				case 4: // #rgb
				case 5: // #rgba
					return [
						(parseInt(hex[1], 16) || 0) / 15,
						(parseInt(hex[2], 16) || 0) / 15,
						(parseInt(hex[3], 16) || 0) / 15,
						hex.length === 5 ? (parseInt(hex[4], 16) || 0) / 15 : 1,
					];
				case 7: // #rrggbb
				case 9: // #rrggbbaa
					return [
						(parseInt(hex.slice(1, 3), 16) || 0) / 255,
						(parseInt(hex.slice(3, 5), 16) || 0) / 255,
						(parseInt(hex.slice(5, 7), 16) || 0) / 255,
						hex.length === 9 ? (parseInt(hex.slice(7, 9), 16) || 0) / 255 : 1,
					];
				default:
					return [1, 1, 1, 1];
			}
		};

		/**
		 * @param {number} r
		 * @param {number} g
		 * @param {number} b
		 * @param {number} a
		 */
		aux.rgba2hex = (r, g, b, a) => {
			return [
				'#',
				Math.floor(r * 255).toString(16).padStart(2, '0'),
				Math.floor(g * 255).toString(16).padStart(2, '0'),
				Math.floor(b * 255).toString(16).padStart(2, '0'),
				Math.floor(a * 255).toString(16).padStart(2, '0'),
			].join('');
		};

		// i don't feel like making an awkward adjustment to aux.rgba2hex
		/**
		 * @param {number} r
		 * @param {number} g
		 * @param {number} b
		 * @param {any} _a
		 */
		aux.rgba2hex6 = (r, g, b, _a) => {
			return [
				'#',
				Math.floor(r * 255).toString(16).padStart(2, '0'),
				Math.floor(g * 255).toString(16).padStart(2, '0'),
				Math.floor(b * 255).toString(16).padStart(2, '0'),
			].join('');
		};

		/** @param {string} name */
		aux.parseName = name => name.match(/^\{.*?\}(.*)$/)?.[1] ?? name;

		/** @param {string} skin */
		aux.parseSkin = skin => {
			if (!skin) return skin;
			skin = skin.replace('1%', '').replace('2%', '').replace('3%', '');
			return '/static/skins/' + skin + '.png';
		};

		/** @type {{
		 * 	cellColor?: [number, number, number, number],
		 * 	foodColor?: [number, number, number, number],
		 * 	mapColor?: [number, number, number, number],
		 * 	outlineColor?: [number, number, number, number],
		 * 	nameColor1?: [number, number, number, number],
		 * 	nameColor2?: [number, number, number, number],
		 * 	hidePellets?: boolean,
		 * 	rapidFeedKey?: string,
		 * 	removeOutlines?: boolean,
		 * 	skinReplacement?: { original: string | null, replacement?: string | null, replaceImg?: string | null },
		 * 	virusImage?: string,
		 * } | undefined} */
		aux.sigmodSettings = undefined;
		setInterval(() => {
			// @ts-expect-error
			const sigmod = window.sigmod?.settings;
			if (sigmod) {
				let sigmodSettings = aux.sigmodSettings = {};
				/**
				 * @param {'cellColor' | 'foodColor' | 'mapColor' | 'outlineColor' | 'nameColor1' | 'nameColor2'} prop
				 * @param {any[]} lookups
				 */
				const applyColor = (prop, lookups) => {
					for (const lookup of lookups) {
						if (lookup) {
							sigmodSettings[prop] = aux.hex2rgba(lookup);
							return;
						}
					}
				};
				applyColor('cellColor', [sigmod.game?.cellColor]);
				applyColor('foodColor', [sigmod.game?.foodColor]);
				applyColor('mapColor', [sigmod.game?.map?.color, sigmod.mapColor]);
				// sigmod treats the map border as cell borders for some reason
				if (!['#00f', '#00f0', '#0000ff', '#000000ffff'].includes(sigmod.game?.borderColor))
					applyColor('outlineColor', [sigmod.game?.borderColor]);
				// note: singular nameColor takes priority
				applyColor('nameColor1', [
					sigmod.game?.name?.color,
					sigmod.game?.name?.gradient?.enabled && sigmod.game.name.gradient.left,
				]);
				applyColor('nameColor2', [
					sigmod.game?.name?.color,
					sigmod.game?.name?.gradient?.enabled && sigmod.game.name.gradient.right,
				]);
				// v10 does not have a 'hide food' setting which is crucial to solid one-tab multiboxing;
				// check food's transparency
				aux.sigmodSettings.hidePellets = aux.sigmodSettings.foodColor?.[3] === 0;
				aux.sigmodSettings.removeOutlines = sigmod.game?.removeOutlines;
				aux.sigmodSettings.skinReplacement = sigmod.game?.skins;
				aux.sigmodSettings.virusImage = sigmod.game?.virusImage;
				aux.sigmodSettings.rapidFeedKey = sigmod.macros?.keys?.rapidFeed;
			}
		}, 50);

		/**
		 * @param {string} selector
		 * @param {boolean} value
		 */
		aux.setting = (selector, value) => {
			/** @type {HTMLInputElement | null} */
			const el = document.querySelector(selector);
			return el ? el.checked : value;
		};

		/**
		 * Only changes sometimes, like when your skin is updated
		 * @type {object | undefined}
		 */
		aux.settings = undefined;
		function settings() {
			try {
				aux.settings = JSON.parse(localStorage.getItem('settings') ?? '');
			} catch (_) { }
		}

		settings();
		setInterval(settings, 50);
		// apply saved gamemode because sigmally fixes connects before the main game even loads
		if (aux.settings?.gamemode) {
			/** @type {HTMLSelectElement | null} */
			const gamemode = document.querySelector('select#gamemode');
			if (gamemode)
				gamemode.value = aux.settings.gamemode;
		}

		aux.textEncoder = new TextEncoder();
		aux.textDecoder = new TextDecoder();

		const trimCtx = aux.require(
			document.createElement('canvas').getContext('2d'),
			'Unable to get 2D context for text utilities. This is probably your browser being dumb, maybe reload ' +
			'the page?',
		);
		trimCtx.font = '20px Ubuntu';
		/**
		 * trims text to a max of 250px at 20px font, same as vanilla sigmally
		 * @param {string} text
		 */
		aux.trim = text => {
			while (trimCtx.measureText(text).width > 250)
				text = text.slice(0, -1);

			return text;
		};

		/*
			If you have Sigmally open in two tabs and you're playing with an account, one has an outdated token while
			the other has the latest one. This causes problems because the tab with the old token does not work properly
			during the game (skin, XP) To fix this, the latest token is sent to the previously opened tab. This way you
			can collect XP in both tabs and use your selected skin.
			@czrsd
		*/
		/** @type {{ token: string, updated: number } | undefined} */
		aux.token = undefined;
		const tokenChannel = new BroadcastChannel('sigfix-token');
		tokenChannel.addEventListener('message', msg => {
			/** @type {{ token: string, updated: number }} */
			const token = msg.data;
			if (!aux.token || aux.token.updated < token.updated)
				aux.token = token;
		});

		/** @type {object | undefined} */
		aux.userData = undefined;
		aux.oldFetch = fetch.bind(window);
		// this is the best method i've found to get the userData object, since game.js uses strict mode
		Object.defineProperty(window, 'fetch', {
			value: new Proxy(fetch, {
				apply: (target, thisArg, args) => {
					let url = args[0];
					const data = args[1];
					if (typeof url === 'string') {
						if (url.includes('/server/recaptcha/v3'))
							return new Promise(() => { }); // block game.js from attempting to go through captcha flow

						// game.js doesn't think we're connected to a server, we default to eu0 because that's the
						// default everywhere else
						if (url.includes('/userdata/')) url = url.replace('///', '//eu0.sigmally.com/server/');

						// patch the current token in the url and body of the request
						if (aux.token) {
							// 128 hex characters surrounded by non-hex characters (lookahead and lookbehind)
							const tokenTest = /(?<![0-9a-fA-F])[0-9a-fA-F]{128}(?![0-9a-fA-F])/g;
							url = url.replaceAll(tokenTest, aux.token.token);
							if (typeof data?.body === 'string')
								data.body = data.body.replaceAll(tokenTest, aux.token.token);
						}

						args[0] = url;
						args[1] = data;
					}

					return target.apply(thisArg, args).then(res => new Proxy(res, {
						get: (target, prop, _receiver) => {
							if (prop !== 'json') {
								const val = target[prop];
								if (typeof val === 'function')
									return val.bind(target);
								else
									return val;
							}

							return () => target.json().then(obj => {
								if (obj?.body?.user) {
									aux.userData = obj.body.user;
									// NaN if invalid / undefined
									let updated = Number(new Date(aux.userData.updateTime));
									if (Number.isNaN(updated))
										updated = Date.now();

									if (!aux.token || updated >= aux.token.updated) {
										aux.token = { token: aux.userData.token, updated };
										tokenChannel.postMessage(aux.token);
									}
								}

								return obj;
							});
						},
					}));
				},
			}),
		});

		/** @param {number} ms */
		aux.wait = ms => new Promise(resolve => setTimeout(resolve, ms));

		return aux;
	})();



	////////////////////////
	// Destroy Old Client //
	////////////////////////
	const destructor = await (async () => {
		// #1 : kill the rendering process
		const oldRQA = requestAnimationFrame;
		window.requestAnimationFrame = function (fn) {
			try {
				throw new Error();
			} catch (err) {
				// prevent drawing the game, but do NOT prevent saving settings (which is called on RQA)
				if (!err.stack.includes('/game.js') || err.stack.includes('HTML'))
					return oldRQA(fn);
			}

			return -1;
		};

		// #2 : kill access to using a WebSocket
		const realWebSocket = WebSocket;
		Object.defineProperty(window, 'WebSocket', new Proxy(WebSocket, {
			construct(_target, argArray, _newTarget) {
				if (argArray[0]?.includes('sigmally.com')) {
					throw new Error('Nope :) - hooked by Sigmally Fixes');
				}

				// @ts-expect-error
				return new oldWS(...argArray);
			},
		}));

		const leaveWorldRepresentation = new TextEncoder().encode('/leaveworld').toString();
		/** @type {WeakSet<WebSocket>} */
		const safeWebSockets = new WeakSet();
		let realWsSend = WebSocket.prototype.send;
		WebSocket.prototype.send = function (x) {
			if (!safeWebSockets.has(this) && this.url.includes('sigmally.com')) {
				this.onclose = null;
				this.close();
				throw new Error('Nope :) - hooked by Sigmally Fixes');
			}

			if (settings.blockNearbyRespawns) {
				let matched = false;
				if (x instanceof ArrayBuffer) {
					matched = x.byteLength === '/leaveworld'.length + 3
						&& new Uint8Array(x).toString().includes(leaveWorldRepresentation);
				} else if (x instanceof Uint8Array) {
					matched = x.byteLength === '/leaveworld'.length + 3
						&& x.toString().includes(leaveWorldRepresentation);
				}

				if (matched) {
					// trying to respawn; see if we are nearby an alive multi-tab
					if (world.mine.length > 0) {
						for (const [_, data] of sync.others) {
							const d = Math.hypot(data.camera.tx - world.camera.tx, data.camera.ty - world.camera.ty);
							if (data.owned.size > 0 && d <= 7500)
								return;
						}
					}
				}
			}

			return realWsSend.apply(this, arguments);
		};

		// #3 : prevent keys from being registered by the game
		setInterval(() => {
			onkeydown = null;
			onkeyup = null;
		}, 50);

		return { realWebSocket, safeWebSockets };
	})();



	/////////////////////
	// Prepare Game UI //
	/////////////////////
	const ui = (() => {
		const ui = {};

		(() => {
			const title = document.querySelector('#title');
			if (!title) return;

			const watermark = document.createElement('span');
			watermark.innerHTML = `<a href="https://greasyfork.org/scripts/483587/versions" \
				target="_blank">Sigmally Fixes ${sfVersion}</a> by yx`;
			title.insertAdjacentElement('afterend', watermark);

			// check if this version is problematic, don't do anything if this version is too new to be in versions.json
			// take care to ensure users can't be logged
			fetch('https://raw.githubusercontent.com/8y8x/sigmally-fixes/main/versions.json')
				.then(res => res.json())
				.then(res => {
					if (sfVersion in res && !res[sfVersion].ok && res[sfVersion].alert) {
						const color = res[sfVersion].color || '#f00';
						const box = document.createElement('div');
						box.style.cssText = `background: ${color}3; border: 1px solid ${color}; width: 100%; \
							height: fit-content; font-size: 1em; padding: 5px; margin: 5px 0; border-radius: 3px; \
							color: ${color}`;
						box.innerHTML = String(res[sfVersion].alert)
							.replace(/\<|\>/g, '') // never allow html tag injection
							.replace(/\{link\}/g, '<a href="https://greasyfork.org/scripts/483587">[click here]</a>')
							.replace(/\{autolink\}/g, '<a href="\
								https://update.greasyfork.org/scripts/483587/Sigmally%20Fixes%20V2.user.js">\
								[click here]</a>');

						watermark.insertAdjacentElement('afterend', box);
					}
				})
				.catch(err => console.warn('Failed to check Sigmally Fixes version:', err));
		})();

		ui.game = (() => {
			const game = {};

			const newCanvas = document.createElement('canvas');
			newCanvas.id = 'sf-canvas';
			newCanvas.style.cssText = `background: #003; width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;
				z-index: 1;`;
			game.canvas = newCanvas;
			(document.querySelector('body div') ?? document.body).appendChild(newCanvas);

			/** @type {HTMLCanvasElement | null} */
			const oldCanvas = document.querySelector('canvas#canvas');
			if (oldCanvas) {
				// leave the old canvas so the old client can actually run
				oldCanvas.style.display = 'none';

				// forward macro inputs from the canvas to the old one - this is for sigmod mouse button controls
				newCanvas.addEventListener('mousedown', e => oldCanvas.dispatchEvent(new MouseEvent('mousedown', e)));
				newCanvas.addEventListener('mouseup', e => oldCanvas.dispatchEvent(new MouseEvent('mouseup', e)));
				// forward mouse movements from the old canvas to the window - this is for sigmod keybinds that move
				// the mouse
				oldCanvas.addEventListener('mousemove', e => dispatchEvent(new MouseEvent('mousemove', e)));
			}

			const gl = aux.require(
				newCanvas.getContext('webgl2'),
				'Couldn\'t get WebGL2 context. Possible causes:\r\n' +
				'- Maybe GPU/Hardware acceleration needs to be enabled in your browser settings; \r\n' +
				'- Maybe your browser is just acting weird and it might fix itself after a restart; \r\n' +
				'- Maybe your GPU drivers are exceptionally old.',
			);

			game.gl = gl;

			// indicate that we will restore the context
			newCanvas.addEventListener('webglcontextlost', e => {
				e.preventDefault(); // signal that we want to restore the context
				// cleanup old caches (after render), as we can't do this within initWebGL()
				render.resetTextCache();
				render.resetTextureCache();
			});
			newCanvas.addEventListener('webglcontextrestored', () => initWebGL());

			function resize() {
				newCanvas.width = Math.floor(innerWidth * devicePixelRatio);
				newCanvas.height = Math.floor(innerHeight * devicePixelRatio);
				game.gl.viewport(0, 0, newCanvas.width, newCanvas.height);
			}

			addEventListener('resize', resize);
			resize();

			return game;
		})();

		ui.stats = (() => {
			const container = document.createElement('div');
			container.style.cssText = 'position: fixed; top: 10px; left: 10px; width: 400px; height: fit-content; \
				user-select: none; z-index: 2; transform-origin: top left;';
			document.body.appendChild(container);

			const score = document.createElement('div');
			score.style.cssText = 'font-family: Ubuntu; font-size: 30px; color: #fff; line-height: 1.0;';
			container.appendChild(score);

			const measures = document.createElement('div');
			measures.style.cssText = 'font-family: Ubuntu; font-size: 20px; color: #fff; line-height: 1.1;';
			container.appendChild(measures);

			const misc = document.createElement('div');
			// white-space: pre; allows using \r\n to insert line breaks
			misc.style.cssText = 'font-family: Ubuntu; font-size: 14px; color: #fff; white-space: pre; \
				line-height: 1.1; opacity: 0.5;';
			container.appendChild(misc);

			/** @param {object} statData */
			function update(statData) {
				let uptime;
				if (statData.uptime < 60) {
					uptime = '<1min';
				} else {
					uptime = Math.floor(statData.uptime / 60 % 60) + 'min';
					if (statData.uptime >= 60 * 60)
						uptime = Math.floor(statData.uptime / 60 / 60 % 24) + 'hr ' + uptime;
					if (statData.uptime >= 24 * 60 * 60)
						uptime = Math.floor(statData.uptime / 24 / 60 / 60 % 60) + 'd ' + uptime;
				}

				misc.textContent = [
					`${statData.name} (${statData.mode})`,
					`${statData.playersTotal} / ${statData.playersLimit} players`,
					`${statData.playersAlive} playing`,
					`${statData.playersSpect} spectating`,
					`${(statData.update * 2.5).toFixed(1)}% load @ ${uptime}`,
				].join('\r\n');
			}

			function matchTheme() {
				let color = aux.setting('input#darkTheme', true) ? '#fff' : '#000';
				score.style.color = color;
				measures.style.color = color;
				misc.style.color = color;
			}

			matchTheme();

			return { container, score, measures, misc, update, matchTheme };
		})();

		ui.leaderboard = (() => {
			const container = document.createElement('div');
			container.style.cssText = 'position: fixed; top: 10px; right: 10px; width: 200px; height: fit-content; \
				user-select: none; z-index: 2; background: #0006; padding: 15px 5px; transform-origin: top right; \
				display: none;';
			document.body.appendChild(container);

			const title = document.createElement('div');
			title.style.cssText = 'font-family: Ubuntu; font-size: 30px; color: #fff; text-align: center; width: 100%;';
			title.textContent = 'Leaderboard';
			container.appendChild(title);

			const linesContainer = document.createElement('div');
			linesContainer.style.cssText = 'font-family: Ubuntu; font-size: 20px; line-height: 1.2; width: 100%; \
				height: fit-content; text-align: center; white-space: pre; overflow: hidden;';
			container.appendChild(linesContainer);

			const lines = [];
			for (let i = 0; i < 11; ++i) {
				const line = document.createElement('div');
				line.style.display = 'none';
				linesContainer.appendChild(line);
				lines.push(line);
			}

			function update() {
				world.leaderboard.forEach((entry, i) => {
					const line = lines[i];
					if (!line) return;

					line.style.display = 'block';
					line.textContent = `${entry.place ?? i + 1}. ${entry.name || 'An unnamed cell'}`;
					if (entry.me)
						line.style.color = '#faa';
					else if (entry.sub)
						line.style.color = '#ffc826';
					else
						line.style.color = '#fff';
				});

				for (let i = world.leaderboard.length; i < lines.length; ++i)
					lines[i].style.display = 'none';
			}

			return { container, title, linesContainer, lines, update };
		})();

		/** @type {HTMLElement} */
		const mainMenu = aux.require(
			document.querySelector('#__line1')?.parentElement,
			'Can\'t find the main menu UI. Try reloading the page?',
		);

		/** @type {HTMLElement} */
		const statsContainer = aux.require(
			document.querySelector('#__line2'),
			'Can\'t find the death screen UI. Try reloading the page?',
		);

		/** @type {HTMLElement} */
		const continueButton = aux.require(
			document.querySelector('#continue_button'),
			'Can\'t find the continue button (on death). Try reloading the page?',
		);

		/** @type {HTMLElement | null} */
		const menuLinks = document.querySelector('#menu-links');
		/** @type {HTMLElement | null} */
		const overlay = document.querySelector('#overlays');

		// sigmod uses this to detect if the menu is closed or not, otherwise this is unnecessary
		/** @type {HTMLElement | null} */
		const menuWrapper = document.querySelector('#menu-wrapper');

		let escOverlayVisible = true;
		/**
		 * @param {boolean} [show]
		 */
		ui.toggleEscOverlay = show => {
			escOverlayVisible = show ?? !escOverlayVisible;
			if (escOverlayVisible) {
				mainMenu.style.display = '';
				if (overlay) overlay.style.display = '';
				if (menuLinks) menuLinks.style.display = '';
				if (menuWrapper) menuWrapper.style.display = '';

				ui.deathScreen.hide();
			} else {
				mainMenu.style.display = 'none';
				if (overlay) overlay.style.display = 'none';
				if (menuLinks) menuLinks.style.display = 'none';
				if (menuWrapper) menuWrapper.style.display = 'none';
			}
		};

		ui.escOverlayVisible = () => escOverlayVisible;

		ui.deathScreen = (() => {
			const deathScreen = {};

			continueButton.addEventListener('click', () => {
				ui.toggleEscOverlay(true);
			});

			// i'm not gonna buy a boost to try and figure out how this thing works
			/** @type {HTMLElement | null} */
			const bonus = document.querySelector('#menu__bonus');
			if (bonus) bonus.style.display = 'none';

			/**
			 * @param {{ foodEaten: number, highestScore: number, highestPosition: number,
			 * spawnedAt: number | undefined }} stats
			 */
			deathScreen.show = stats => {
				const foodEatenElement = document.querySelector('#food_eaten');
				if (foodEatenElement)
					foodEatenElement.textContent = stats.foodEaten.toString();

				const highestMassElement = document.querySelector('#highest_mass');
				if (highestMassElement)
					highestMassElement.textContent = Math.round(stats.highestScore).toString();

				const highestPositionElement = document.querySelector('#top_leaderboard_position');
				if (highestPositionElement)
					highestPositionElement.textContent = stats.highestPosition.toString();

				const timeAliveElement = document.querySelector('#time_alive');
				if (timeAliveElement) {
					let time;
					if (stats.spawnedAt === undefined)
						time = 0;
					else
						time = (performance.now() - stats.spawnedAt) / 1000;
					const hours = Math.floor(time / 60 / 60);
					const mins = Math.floor(time / 60 % 60);
					const seconds = Math.floor(time % 60);

					timeAliveElement.textContent = `${hours ? hours + ' h' : ''} ${mins ? mins + ' m' : ''} `
						+ `${seconds ? seconds + ' s' : ''}`;
				}

				statsContainer.classList.remove('line--hidden');
				ui.toggleEscOverlay(false);
				if (overlay) overlay.style.display = '';

				stats.foodEaten = 0;
				stats.highestScore = 0;
				stats.highestPosition = 0;
				stats.spawnedAt = undefined;

				// refresh ads... ...yep
				const { adSlot4, adSlot5, adSlot6, googletag } = /** @type {any} */ (window);
				if (googletag) {
					googletag.cmd.push(() => googletag.display(adSlot4));
					googletag.cmd.push(() => googletag.display(adSlot5));
					googletag.cmd.push(() => googletag.display(adSlot6));
				}
			};

			deathScreen.hide = () => {
				const shown = !statsContainer?.classList.contains('line--hidden');
				statsContainer?.classList.add('line--hidden');
				const { googletag } = /** @type {any} */ (window);
				if (shown && googletag) {
					googletag.cmd.push(() => googletag.pubads().refresh());
				}
			};

			return deathScreen;
		})();

		ui.minimap = (() => {
			const canvas = document.createElement('canvas');
			canvas.style.cssText = 'position: absolute; bottom: 0; right: 0; background: #0006; width: 200px; \
				height: 200px; z-index: 2; user-select: none;';
			canvas.width = canvas.height = 200;
			document.body.appendChild(canvas);

			const ctx = aux.require(
				canvas.getContext('2d'),
				'Unable to get 2D context for the minimap. This is probably your browser being dumb, maybe reload ' +
				'the page?',
			);

			return { canvas, ctx };
		})();

		ui.chat = (() => {
			const chat = {};

			const block = aux.require(
				document.querySelector('#chat_block'),
				'Can\'t find the chat UI. Try reloading the page?',
			);

			/**
			 * @param {ParentNode} root
			 * @param {string} selector
			 */
			function clone(root, selector) {
				/** @type {HTMLElement} */
				const old = aux.require(
					root.querySelector(selector),
					`Can't find this chat element: ${selector}. Try reloading the page?`,
				);

				const el = /** @type {HTMLElement} */ (old.cloneNode(true));
				el.id = '';
				old.style.display = 'none';
				old.insertAdjacentElement('afterend', el);

				return el;
			}

			// can't just replace the chat box - otherwise sigmod can't hide it - so we make its children invisible
			// elements grabbed with clone() are only styled by their class, not id
			const toggle = clone(document, '#chat_vsbltyBtn');
			const scrollbar = clone(document, '#chat_scrollbar');
			const thumb = clone(scrollbar, '#chat_thumb');

			const input = chat.input = /** @type {HTMLInputElement} */ (aux.require(
				document.querySelector('#chat_textbox'),
				'Can\'t find the chat textbox. Try reloading the page?',
			));

			const list = document.createElement('div');
			list.style.cssText = 'width: 400px; height: 182px; position: absolute; bottom: 54px; left: 46px; \
				overflow: hidden; user-select: none; z-index: 301;';
			block.appendChild(list);

			let toggled = true;
			toggle.style.borderBottomLeftRadius = '10px'; // a bug fix :p
			toggle.addEventListener('click', () => {
				toggled = !toggled;
				input.style.display = toggled ? '' : 'none';
				scrollbar.style.display = toggled ? 'block' : 'none';
				list.style.display = toggled ? '' : 'none';

				if (toggled) {
					toggle.style.borderTopRightRadius = toggle.style.borderBottomRightRadius = '';
					toggle.style.opacity = '';
				} else {
					toggle.style.borderTopRightRadius = toggle.style.borderBottomRightRadius = '10px';
					toggle.style.opacity = '0.25';
				}
			});

			scrollbar.style.display = 'block';
			let scrollTop = 0; // keep a float here, because list.scrollTop is always casted to an int
			let thumbHeight = 1;
			let lastY;
			thumb.style.height = '182px';

			function updateThumb() {
				thumb.style.bottom = (1 - list.scrollTop / (list.scrollHeight - 182)) * (182 - thumbHeight) + 'px';
			}

			function scroll() {
				if (scrollTop >= list.scrollHeight - 182 - 40) {
					// close to bottom, snap downwards
					list.scrollTop = scrollTop = list.scrollHeight - 182;
				}

				thumbHeight = Math.min(Math.max(182 / list.scrollHeight, 0.1), 1) * 182;
				thumb.style.height = thumbHeight + 'px';
				updateThumb();
			}

			let scrolling = false;
			thumb.addEventListener('mousedown', () => void (scrolling = true));
			addEventListener('mouseup', () => void (scrolling = false));
			addEventListener('mousemove', e => {
				const deltaY = e.clientY - lastY;
				lastY = e.clientY;

				if (!scrolling) return;
				e.preventDefault();

				if (lastY === undefined) {
					lastY = e.clientY;
					return;
				}

				list.scrollTop = scrollTop = Math.min(Math.max(
					scrollTop + deltaY * list.scrollHeight / 182, 0), list.scrollHeight - 182);
				updateThumb();
			});

			let lastWasBarrier = true; // init to true, so we don't print a barrier as the first ever message (ugly)
			/**
			 * @param {string} authorName
			 * @param {[number, number, number, number]} rgb
			 * @param {string} text
			 */
			chat.add = (authorName, rgb, text) => {
				lastWasBarrier = false;

				const container = document.createElement('div');
				const author = document.createElement('span');
				author.style.cssText = `color: ${aux.rgba2hex(...rgb)}; padding-right: 0.75em;`;
				author.textContent = aux.trim(authorName);
				container.appendChild(author);

				const msg = document.createElement('span');
				msg.textContent = aux.trim(text);
				container.appendChild(msg);

				while (list.children.length > 100)
					list.firstChild?.remove();

				list.appendChild(container);

				scroll();
			};

			chat.barrier = () => {
				if (lastWasBarrier) return;
				lastWasBarrier = true;

				const barrier = document.createElement('div');
				barrier.style.cssText = 'width: calc(100% - 20px); height: 1px; background: #8888; margin: 10px;';
				list.appendChild(barrier);

				scroll();
			};

			chat.matchTheme = () => {
				list.style.color = aux.setting('input#darkTheme', true) ? '#fffc' : '#000c';
			};

			return chat;
		})();

		/** @param {string} msg */
		ui.error = msg => {
			const modal = /** @type {HTMLElement | null} */ (document.querySelector('#errormodal'));
			const desc = document.querySelector('#errormodal p');
			if (desc)
				desc.innerHTML = msg;

			if (modal)
				modal.style.display = 'block';
		};

		// sigmod quick fix
		(() => {
			// the play timer is inserted below the top-left stats, but because we offset them, we need to offset this
			// too
			const style = document.createElement('style');
			style.textContent = '.playTimer { transform: translate(5px, 10px); }';
			document.head.appendChild(style);
		})();

		return ui;
	})();



	/////////////////////////////
	// Load WebAssembly Module //
	/////////////////////////////
	const wasm = await (async () => {
		const src = 'data:application/octet-stream;base64,'
			+ 'AGFzbQEAAAABRwtgAAF8YAJ/fwF/YAN/f38Bf2AMf3x/fHx8f39/f39/AX9gA39/fwBgAX8Bf2AAAX9gA398fAF8YAF/AGACf3wAYAJ/fAF/AjYDBG1haW4GbWVtb3J5AgAbCHNldHRpbmdzCmRyYXdfZGVsYXkAAAZzdHJpbmcGdG9fcmVmAAEDExIBAgMEBQUBBgUFBwQFBggJCQoGLgd/AUEBC38BQYAIC38BQYAgC38BQYCACAt/AUGAgAQLfwFBgIAgC38BQYCALAsHnwIRDWNlbGwuYWxsb2NhdGUAAgpjZWxsLmJ5X2lkAAMLY2VsbC5jcmVhdGUABA9jZWxsLmRlYWxsb2NhdGUABRNjZWxsLmZpcnN0X2NlbGxfcHRyAAYVY2VsbC5maXJzdF9wZWxsZXRfcHRyAAcTY2VsbC5ncm93X3RhYl9zcGFjZQAJDmNlbGwubnVtX2NlbGxzAAoQY2VsbC5udW1fcGVsbGV0cwALDmNlbGwueHlyX2FscGhhAAwMbWlzYy5tZW1jcHk4AA0PbWlzYy51bnRpbF96ZXJvAA4MdGFiLmFsbG9jYXRlAA8JdGFiLmNsZWFyABALdGFiLmNsZWFudXAAEQh0YWIuc29ydAASEHdzLmhhbmRsZV91cGRhdGUAEwqnEBJVAQN/QYCAwAAjBiAAbGohAiACIwNqIwVBAEEEIAEbamohAyADKAIAIQQgBCMCIwEgARtPBEBBAA8LIAJBACMFIAEbakGAASAEbGogAyAEQQFqNgIAC0MBAn9BgIDAACMGIABsQQAjBSACG2pqIQQDQCAEKAIAIQMgAyABRgRAIAQPCyADRQRAQQAPCyAEQYABaiEEDAALQQALuAEBAn8gBUQAAAAAAAA0QGUhDSAAIA0QAiEMIAxFBEAQCUUEQEEADwsgACANEAIhDAsgDCACNgIAIAwgCTYCBCAMIAM5AwggDCAEOQMQIAwgBTkDGCAMIAU5AyAgDCADOQMoIAwgBDkDMCAMIAU5AzggDCABOQNAIAwgATkDSCAMRAAAAAAAAPB/OQNQIAxBADYCWCAMIAs2AlwgDCAKNgJgIAwgCDYCZCAMIAY6AGggDCAHOgBpIAwLXwEEf0GAgMAAIwYgAGxqIQMgAyMDaiMFQQBBBCACG2pqIQUgBSgCAEEBayEGIANBACMFIAIbakGAASAGbGohBCABIARHBEAgBCABQYABEA0LIARBADYCACAFIAY2AgALEABBgIDAACMGIABsIwVqagsNAEGAgMAAIwYgAGxqCy4BAX8DQCABKAIAIQIgAiAARgRAIAEPCyACRQRAQQAPCyABQYABaiEBDAALQQALpwEBBH8jAyMFaiMAbEEQdkAAQX9GBEBBAA8LIwBBf2ohAQNAQYCAwAAjBiABbGohAkGAgMAAIwZBAmwgAWxqIQMgAiMDIwVqaiADIwMjBWpBAmxqQYCABBANIAIjBWogAyMFQQJsaiMDEA0gAiADIwUQDSABQX9qIgFBAE4NAAsjAUECbCQBIwJBAmwkAiMDQQJsJAMjBUECbCQFIwMjBWojBGokBkEBCxkAQYCAwAAjBiAAbGojBSMDakEEamooAgALFgBBgIDAACMGIABsaiMFIwNqaigCAAshACABIAArA0ChIAKjRAAAAAAAAAAApUQAAAAAAADwP6QLKwEBfyAAIAJqIQMDQCABIAApAwA3AwAgAUEIaiEBIABBCGoiACADSQ0ACwsVAANAIAAtAAAgAEEBaiEADQALIAALFAAjBkEQdkAAQX9GBEBBAA8LQQELjgEBAX9BgIDAACMGIABsaiEBAkADQCABKAIARQ0BIAFBADYCACABQYABaiEBDAALC0GAgMAAIwYgAGwjBWpqIQECQANAIAEoAgBFDQEgAUEANgIAIAFBgAFqIQEMAAsLQYCAwAAjBiAAbCMFIwNqampBADYCAEGAgMAAIwYgAGwjBSMDakEEampqQQA2AgALjQEBAX9BgIDAACMGIABsaiECAkADQCACKAIARQ0BIAIrA1BEAAAAAADAckCgIAFjBEAgACACQQEQBQUgAkGAAWohAgsMAAsLQYCAwAAjBWojBiAAbGohAgJAA0AgAigCAEUNASACKwNQRAAAAAAAwHJAoCABYwRAIAAgAkEAEAUFIAJBgAFqIQILDAALCwvqAQYBfAF/AXwDfwF8AX9BgIDAACMGIABsIwVqaiEDIAAQCiEFQQEhBgJAA0AgBiAFTw0BIAMgBkGAAWxqQYD/P0GAARANIAMgBkGAAWxqKAIAIQkgAyAGQYABbGorAzghCCAGQQFrIQcCQANAIAdBAEgNASADIAdBgAFsaisDOCAIYw0BIAMgB0GAAWxqKwM4IAhhIAMgB0GAAWxqKAIAIAlLcQ0BIAMgB0GAAWxqIAMgB0EBakGAAWxqQYABEA0gB0EBayEHDAALC0GA/z8gAyAHQQFqQYABbGpBgAEQDSAGQQFqIQYMAAsLC8QFBAZ/A3wIfwN8EAAhFUEBIQcgBy8BACECIAdBAmohBwJAA0AgAkUNASACQQFrIQIgBygCACEFIAdBBGohByAHKAIAIQYgB0EEaiEHIAAgBkEBEAMhDSANRQRAIAAgBkEAEAMhDSANRQ0BCyANIAE5A1AgDSABOQNAIA0gBTYCWAwACwsCQANAIAcoAgAhBSAHQQRqIQcgBUUNASAHLgEAtyEIIAdBAmohByAHLgEAtyEJIAdBAmohByAHLwEAuCEKIAdBAmohByAHLQAAIQMgA0ERcUVFIQsgB0EDaiEHIActAABFRSEMIAdBAWohByAHIAcQDiIHEAEhECADQQJxBEAgBy0AACERIAdBAWohByARIActAABBCHRyIREgB0EBaiEHIBEgBy0AAEEQdHIhESAHQQFqIQcLIANBBHEEQCAHIAcQDiIHEAEhDwsgA0EIcQRAIAcgBxAOIgcQASEOCyAKRAAAAAAAADRAZSESIAAgBSASEAMhDQJAIA0EQCANKwNQIAFkDQEgACANIBIQBQsgACABIAUgCCAJIAogCyAMIBAgESAPIA4QBBoMAQsgDSABIBUQDCETRAAAAAAAAPA/IBOhIRQgDSANKwMIIBSiIA0rAyggE6KgOQMIIA0gDSsDECAUoiANKwMwIBOioDkDECANIA0rAxggFKIgDSsDOCAToqA5AxggDSAKOQMgIA0gCDkDKCANIAk5AzAgDSAKOQM4IA0gATkDQCANIBA2AmQgA0ECcQRAIA0gETYCBAsgA0EEcQRAIA0gDjYCXAsgA0EIcQRAIA0gDzYCYAsMAAsLIAcvAQAhAiAHQQJqIQcCQANAIAJFDQEgAkEBayECIAcoAgAhBSAHQQRqIQcgACAFQQEQAyENIA1FBEAgACAFQQAQAyENIA1FDQELIA0gATkDUCANIAE5A0AMAAsLIAcL';
		const buffer = await fetch(src).then(res => res.arrayBuffer());

		const memory = new WebAssembly.Memory({ initial: 27 });
		let nextStringRef = 1;
		/** @type {Map<string | number, number | string>} */
		const strings = new Map();
		const textDecoder = new TextDecoder();

		// guarantee ref=0 to be the empty string
		strings.set(0, '');
		strings.set('', 0);

		const imports = {
			main: {
				memory,
			},
			settings: {
				draw_delay: () => settings.drawDelay,
			},
			string: {
				from_ref: ref => {
					return strings.get(ref);
				},
				to_ref: (start, end) => {
					const str = textDecoder.decode(new DataView(memory.buffer, start, end - start - 1));
					const ref = strings.get(str);
					if (ref !== undefined)
						return ref;

					strings.set(str, nextStringRef);
					strings.set(nextStringRef, str);
					return nextStringRef++;
				},
			},
		};

		return WebAssembly.instantiate(buffer, imports).then(res => ({
			...res.instance.exports,
			TEMP: {
				cells: (tab, pellets) => {
					const dat = new DataView(imports.main.memory.buffer);
					const cellCount = res.instance.exports[pellets ? 'cell.num_pellets' : 'cell.num_cells'](tab);
					let cellPtr = res.instance.exports[pellets ? 'cell.first_pellet_ptr' : 'cell.first_cell_ptr'](tab);
					const cells = [];
					for (let i = 0; i < cellCount; ++i, cellPtr += 128) {
						const deadAt = dat.getFloat64(cellPtr + 0x50, true);
						cells.push({
							id: dat.getUint32(cellPtr, true),
							Rgb: dat.getUint8(cellPtr + 4) / 255,
							rGb: dat.getUint8(cellPtr + 5) / 255,
							rgB: dat.getUint8(cellPtr + 6) / 255,
							ox: dat.getFloat64(cellPtr + 8, true),
							oy: dat.getFloat64(cellPtr + 0x10, true),
							or: dat.getFloat64(cellPtr + 0x18, true),
							jr: dat.getFloat64(cellPtr + 0x20, true),
							nx: dat.getFloat64(cellPtr + 0x28, true),
							ny: dat.getFloat64(cellPtr + 0x30, true),
							nr: dat.getFloat64(cellPtr + 0x38, true),
							updated: dat.getFloat64(cellPtr + 0x40, true),
							born: dat.getFloat64(cellPtr + 0x48, true),
							deadAt: deadAt === Infinity ? undefined : deadAt,
							deadTo: deadAt === Infinity ? undefined : -1,
							dead_to: dat.getUint32(cellPtr + 0x58, true),
							name: imports.string.from_ref(dat.getUint32(cellPtr + 0x5c, true)),
							skin: imports.string.from_ref(dat.getUint32(cellPtr + 0x60, true)),
							clan: imports.string.from_ref(dat.getUint32(cellPtr + 0x64, true)),
							jagged: !!dat.getUint8(cellPtr + 0x68),
							sub: !!dat.getUint8(cellPtr + 0x69),
						});
					}

					return cells;
				},
				strings: () => strings,
			},
			imports,
			module: res.module,
		}));
	})();



	/////////////////////////
	// Create Options Menu //
	/////////////////////////
	const { onSettingsSave, settings } = (() => {
		const settings = {
			blockBrowserKeybinds: false,
			blockNearbyRespawns: false,
			cellOpacity: 1,
			cellOutlines: true,
			clans: false,
			drawDelay: 120,
			jellySkinLag: true,
			massBold: false,
			massOpacity: 1,
			massScaleFactor: 1,
			mergeCamera: false,
			mergeCameraWeight: 2,
			mergeViewArea: false,
			nameBold: false,
			nameScaleFactor: 1,
			outlineMulti: 0.2,
			// delta's default colors, #ff00aa and #ffffff
			outlineMultiColor: /** @type {[number, number, number, number]} */ ([1, 0, 2/3, 1]),
			outlineMultiInactiveColor: /** @type {[number, number, number, number]} */ ([1, 1, 1, 1]),
			rtx: false,
			scrollFactor: 1,
			selfSkin: '',
			syncSkin: true,
			tracer: false,
			unsplittableOpacity: 1,
		};

		try {
			Object.assign(settings, JSON.parse(localStorage.getItem('sigfix') ?? ''));
		} catch (_) { }

		/** @type {Set<() => void>} */
		const onSaves = new Set();

		const channel = new BroadcastChannel('sigfix-settings');
		channel.addEventListener('message', msg => {
			Object.assign(settings, msg.data);
			onSaves.forEach(fn => fn());
		});

		// #1 : define helper functions
		/**
		 * @param {string} html
		 * @returns {HTMLElement}
		 */
		function fromHTML(html) {
			const div = document.createElement('div');
			div.innerHTML = html;
			return /** @type {HTMLElement} */ (div.firstElementChild);
		}

		function save() {
			localStorage.setItem('sigfix', JSON.stringify(settings));
			/** @type {any} */
			const replicated = { ...settings };
			delete replicated.selfSkin;
			channel.postMessage(replicated);
		}

		/**
		 * @template O, T
		 * @typedef {{ [K in keyof O]: O[K] extends T ? K : never }[keyof O]} PropertyOfType
		 */

		const vanillaMenu = document.querySelector('#cm_modal__settings .ctrl-modal__content');
		vanillaMenu?.appendChild(fromHTML(`
			<div class="menu__item">
				<div style="width: 100%; height: 1px; background: #bfbfbf;"></div>
			</div>
		`));

		const vanillaContainer = document.createElement('div');
		vanillaContainer.className = 'menu__item';
		vanillaMenu?.appendChild(vanillaContainer);

		const sigmodContainer = document.createElement('div');
		sigmodContainer.className = 'mod_tab scroll';
		sigmodContainer.style.display = 'none';

		/**
		 * @param {PropertyOfType<typeof settings, number>} property
		 * @param {string} title
		 * @param {number} initial
		 * @param {number} min
		 * @param {number} max
		 * @param {number} step
		 * @param {number} decimals
		 * @param {boolean} double
		 * @param {string} help
		 */
		function slider(property, title, initial, min, max, step, decimals, double, help) {
			/**
			 * @param {HTMLInputElement} slider
			 * @param {HTMLElement} display
			 */
			const listen = (slider, display) => {
				slider.value = settings[property].toString();
				display.textContent = settings[property].toFixed(decimals);

				slider.addEventListener('input', () => {
					settings[property] = Number(slider.value);
					display.textContent = settings[property].toFixed(decimals);
					save();
				});

				onSaves.add(() => {
					slider.value = settings[property].toString();
					display.textContent = settings[property].toFixed(decimals);
				});
			};

			const vanilla = fromHTML(`
				<div style="height: ${double ? '50' : '25'}px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" style="display: block; float: left; height: 25px; line-height: 25px;\
							margin-left: 5px;" min="${min}" max="${max}" step="${step}" value="${initial}"
							list="sf-${property}-markers" type="range" />
						<datalist id="sf-${property}-markers"> <option value="${initial}"></option> </datalist>
						<span id="sf-${property}-display" style="display: block; float: left; height: 25px; \
							line-height: 25px; width: 40px; text-align: right;"></span>
					</div>
				</div>
			`);
			listen(
				/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)),
				/** @type {HTMLElement} */(vanilla.querySelector(`#sf-${property}-display`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" title="${help}">
					<span>${title}</span>
					<span class="justify-sb">
						<input id="sfsm-${property}" style="width: 200px;" type="range" min="${min}" max="${max}"
							step="${step}" value="${initial}" list="sfsm-${property}-markers" />
						<datalist id="sfsm-${property}-markers"> <option value="${initial}"></option> </datalist>
						<span id="sfsm-${property}-display" class="text-center" style="width: 75px;"></span>
					</span>
				</div>
			`);
			listen(
				/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)),
				/** @type {HTMLElement} */(sigmod.querySelector(`#sfsm-${property}-display`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, string>} property
		 * @param {string} title
		 * @param {string} placeholder
		 * @param {boolean} sync
		 * @param {string} help
		 */
		function input(property, title, placeholder, sync, help) {
			/**
			 * @param {HTMLInputElement} input
			 */
			const listen = input => {
				let oldValue = input.value = settings[property];

				input.addEventListener('input', () => {
					oldValue = settings[property] = input.value;
					save();
				});

				onSaves.add(() => {
					if (sync) input.value = settings[property];
					else input.value = settings[property] = oldValue;
				});
			};

			const vanilla = fromHTML(`
				<div style="height: 50px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" placeholder="${placeholder}" type="text" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" title="${help}">
					<span>${title}</span>
					<input class="modInput" id="sfsm-${property}" placeholder="${placeholder}" type="text" />
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, boolean>} property
		 * @param {string} title
		 * @param {string} help
		 */
		function checkbox(property, title, help) {
			/**
			 * @param {HTMLInputElement} input
			 */
			const listen = input => {
				input.checked = settings[property];

				input.addEventListener('input', () => {
					settings[property] = input.checked;
					save();
				});

				onSaves.add(() => input.checked = settings[property]);
			};

			const vanilla = fromHTML(`
				<div style="height: 25px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" type="checkbox" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" title="${help}">
					<span>${title}</span>
					<div style="width: 75px; text-align: center;">
						<div class="modCheckbox" style="display: inline-block;">
							<input id="sfsm-${property}" type="checkbox" />
							<label class="cbx" for="sfsm-${property}"></label>
						</div>
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, [number, number, number, number]>} property
		 * @param {string} title
		 * @param {string} help
		 */
		function color(property, title, help) {
			/**
			 * @param {HTMLInputElement} input
			 * @param {HTMLInputElement} visible
			 */
			const listen = (input, visible) => {
				input.value = aux.rgba2hex6(...settings[property]);
				visible.checked = settings[property][3] > 0;

				const changed = () => {
					settings[property] = aux.hex2rgba(input.value);
					settings[property][3] = visible.checked ? 1 : 0;
					save();
				};
				input.addEventListener('input', changed);
				visible.addEventListener('input', changed);

				onSaves.add(() => {
					input.value = aux.rgba2hex6(...settings[property]);
					visible.checked = settings[property][3] > 0;
				});
			};

			const vanilla = fromHTML(`
				<div style="height: 25px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}-visible" type="checkbox" />
						<input id="sf-${property}" type="color" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)),
				/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}-visible`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" title="${help}">
					<span>${title}</span>
					<div style="width: 75px; text-align: center;">
						<div class="modCheckbox" style="display: inline-block;">
							<input id="sfsm-${property}-visible" type="checkbox" />
							<label class="cbx" for="sfsm-${property}-visible"></label>
						</div>
						<input id="sfsm-${property}" type="color" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)),
				/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}-visible`)));
			sigmodContainer.appendChild(sigmod);
		}

		function separator(text = '•') {
			vanillaContainer.appendChild(fromHTML(`<div style="text-align: center; width: 100%;">${text}</div>`));
			sigmodContainer.appendChild(fromHTML(`<span class="text-center">${text}</span>`));
		}

		// #2 : generate ui for settings
		separator('Hover over a setting for more info');
		slider('drawDelay', 'Draw delay', 120, 40, 300, 1, 0, false,
			'How long (in ms) cells will lag behind for. Lower values mean cells will very quickly catch up to where ' +
			'they actually are.');
		slider('unsplittableOpacity', 'Unsplittable cell outline opacity', 1, 0, 1, 0.01, 2, true,
			'How visible the white outline around cells that can\'t split should be. 0 = not visible, 1 = fully ' +
			'visible.');
		checkbox('cellOutlines', 'Cell outlines', 'Whether the subtle dark outlines around cells (including skins) ' +
			'should draw.');
		slider('cellOpacity', 'Cell opacity', 1, 0, 1, 0.01, 2, false,
			'How opaque cells should be. 1 = fully visible, 0 = invisible. It can be helpful to see the size of a ' +
			'smaller cell under a big cell.');
		input('selfSkin', 'Self skin URL (not synced)', 'https://i.imgur.com/...', false,
			'Direct URL to a custom skin for yourself. Not visible to others. You are able to use different skins ' +
			'for different tabs.');
		checkbox('syncSkin', 'Show self skin on other tabs',
			'Whether your custom skin should be shown on your other tabs too.');
		checkbox('tracer', 'Lines between cells and mouse', 'If enabled, draws a line between all of the cells you ' +
			'control and your mouse. Useful as a hint to your subconscious about which tab you\'re currently on.');
		separator();
		checkbox('mergeCamera', 'Merge camera between tabs',
			'Whether to place the camera in between your nearby tabs. This makes tab changes while multiboxing ' +
			'completely seamless (a sort of \'one-tab\'). This mode uses a weighted camera.');
		checkbox('mergeViewArea', 'Combine visible cells between tabs',
			'When enabled, all tabs will share what cells they see between each other. Due to browser limitations, ' +
			'this might be slow on lower-end PCs.');
		slider('outlineMulti', 'Current tab cell outline thickness', 0.2, 0, 1, 0.01, 2, true,
			'Draws an inverse outline on your cells. This is a necessity when using the \'merge camera\' setting. ' +
			'Setting to 0 turns this off. Only shows when near one of your tabs.');
		color('outlineMultiColor', 'Current tab outline color',
			'The outline color of your current multibox tab.');
		color('outlineMultiInactiveColor', 'Other tab outline color',
			'The outline color for the cells of your other unfocused multibox tabs. Turn off the checkbox to disable.');
		slider('mergeCameraWeight', 'Merge camera weighting factor', 1, 0, 2, 0.01, 2, true,
			'The amount of focus to put on bigger cells. Only used with \'merge camera\'. 0 focuses every cell ' +
			'equally, 1 focuses on every cell based on its radius, 2 focuses on every cell based on its mass. ' +
			'Focusing on where your mass is can make the camera much smoother and predictable when splitrunning.');
		separator();
		slider('scrollFactor', 'Zoom speed', 1, 0.05, 1, 0.05, 2, false,
			'A smaller zoom speed lets you fine-tune your zoom.');
		checkbox('blockBrowserKeybinds', 'Block all browser keybinds',
			'When enabled, only Ctrl+Tab and F11 are allowed to be pressed. You must be in fullscreen, and ' +
			'non-Chrome browsers probably won\'t respect this setting.');
		checkbox('blockNearbyRespawns', 'Block respawns near other tabs',
			'Disables the respawn keybind when near one of your bigger tabs.');
		checkbox('rtx', 'RTX', 'Makes everything glow. (Not actually ray-tracing shaders!)');
		separator();
		slider('nameScaleFactor', 'Name scale factor', 1, 0.5, 2, 0.01, 2, false, 'The size multiplier of names.');
		slider('massScaleFactor', 'Mass scale factor', 1, 0.5, 4, 0.01, 2, false,
			'The size multiplier of mass (which is half the size of names)');
		slider('massOpacity', 'Mass opacity', 1, 0, 1, 0.01, 2, false,
			'The opacity of the mass text. You might find it visually appealing to have mass be a little dimmer than ' +
			'names.');
		checkbox('nameBold', 'Bold name text', 'Uses the bold Ubuntu font for names (like Agar.io).');
		checkbox('massBold', 'Bold mass text', 'Uses a bold font for mass');
		separator();
		checkbox('clans', 'Show clans', 'When enabled, shows the name of the clan a player is in above their name.');
		checkbox('jellySkinLag', 'Jelly physics cut-off on skins',
			'Jelly physics causes cells to grow and shrink a little slower, but skins don\'t, which makes clips look ' +
			'more satisfying. But if your skin decorates the edge of your cell (e.g. sasa, has a custom outline), ' +
			'then it may look weird.');

		// #3 : create options for sigmod
		let sigmodInjection;
		sigmodInjection = setInterval(() => {
			const nav = document.querySelector('.mod_menu_navbar');
			const content = document.querySelector('.mod_menu_content');
			if (!nav || !content) return;

			clearInterval(sigmodInjection);

			content.appendChild(sigmodContainer);

			const navButton = fromHTML('<button class="mod_nav_btn">🔥 Sig Fixes</button>');
			nav.appendChild(navButton);
			navButton.addEventListener('click', () => {
				// basically openModTab() from sigmod
				(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.mod_tab'))).forEach(tab => {
					tab.style.opacity = '0';
					setTimeout(() => tab.style.display = 'none', 200);
				});

				(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.mod_nav_btn'))).forEach(tab => {
					tab.classList.remove('mod_selected');
				});

				navButton.classList.add('mod_selected');
				setTimeout(() => {
					sigmodContainer.style.display = 'flex';
					setTimeout(() => sigmodContainer.style.opacity = '1', 10);
				}, 200);
			});
		}, 100);

		return { onSettingsSave: cb => onSaves.add(cb), settings };
	})();



	////////////////////////////////
	// Setup Multi-tab World Sync //
	////////////////////////////////
	/** @typedef {{
	 * 	self: string,
	 * 	camera: { tx: number, ty: number },
	 * 	cells: { cells: Map<number, Cell>, pellets: Map<number, Cell> } | undefined,
	 * 	owned: Map<number, { x: number, y: number, r: number, jx: number, jy: number, jr: number } | false>,
	 * 	skin: string,
	 * 	updated: { now: number, timeOrigin: number },
	 * }} SyncData
	 */
	const sync = (() => {
		const sync = {};
		/** @type {{ cells: Map<number, Cell>, pellets: Map<number, Cell> } | undefined} */
		sync.merge = undefined;
		/** @type {Map<string, SyncData>} */
		sync.others = new Map();

		const frame = new BroadcastChannel('sigfix-frame');
		const worldsync = new BroadcastChannel('sigfix-worldsync');
		const zoom = new BroadcastChannel('sigfix-zoom');
		const self = Date.now() + '-' + Math.random();

		/**
		 * @param {SyncData} data
		 * @param {number} foreignNow
		 */
		const localized = (data, foreignNow) => data.updated.timeOrigin - performance.timeOrigin + foreignNow;
		// foreignNow + data.updated.timeOrigin - performance.timeOrigin; different order so maybe better precision?

		/** @param {number} now */
		sync.broadcast = now => {
			/** @type {SyncData['owned']} */
			const owned = new Map();
			for (const id of world.mine) {
				const cell = world.cells.get(id);
				if (!cell) continue;

				owned.set(id, world.xyr(cell, world, now));
			}
			for (const id of world.mineDead)
				owned.set(id, false);

			// it is stupidly expensive to replicate pellets, so make sure we can disable it
			const hidePellets = aux.sigmodSettings?.hidePellets;

			/** @type {SyncData} */
			const syncData = {
				self,
				camera: { tx: world.camera.tx, ty: world.camera.ty },
				cells: settings.mergeViewArea
					? { cells: world.cells, pellets: hidePellets ? new Map() : world.pellets } : undefined,
				owned,
				skin: settings.selfSkin,
				updated: { now, timeOrigin: performance.timeOrigin },
			};
			worldsync.postMessage(syncData);
		};

		sync.frame = () => {
			frame.postMessage(undefined);
		};

		sync.zoom = () => zoom.postMessage(input.zoom);

		frame.addEventListener('message', () => {
			// only update the world if we aren't rendering ourselves (example case: games open on two monitors)
			if (document.visibilityState === 'hidden') {
				input.move();
				world.update();
			}

			// might be preferable over document.visibilityState
			if (!document.hasFocus())
				input.antiAfk();
		});

		worldsync.addEventListener('message', e => {
			/** @type {SyncData} */
			const data = e.data;
			sync.others.set(data.self, /** @type {any} */(data));
			sync.buildMerge(localized(/** @type {any} */(data), data.updated.now));
		});

		zoom.addEventListener('message', e => void (input.zoom = e.data));

		// clear dead tabs
		setInterval(() => {
			const now = performance.now();
			sync.others.forEach((data, key) => {
				if (now - localized(data, data.updated.now) > 250) {
					sync.others.delete(key);
				}
			});
		}, 250);

		// [timeOffset, cell]
		/** @type {Map<number, [number, Cell]>} */
		const all = new Map();

		/** @param {number} now */
		sync.buildMerge = now => {
			// for camera merging to look extremely smooth, we need to merge packets and apply them *ONLY* when all
			// tabs are synchronized.
			// if you simply fall back to what the other tabs see, you will get lots of flickering and warping (what
			// delta suffers from).
			// threfore, we make sure that all tabs that share visible cells see them in the same spots, to make sure
			// they are all on the same tick
			// it's also not sufficient to simply count how many update (0x10) packets we get, as /leaveworld (part of
			// respawn functionality) stops those packets from coming in
			// if the view areas are disjoint, then there's nothing we can do but this should never happen when
			// splitrunning
			if (!settings.mergeViewArea) {
				sync.merge = undefined;
				return;
			}
			/** @type {Map<number, Cell>} */
			let cells = new Map();
			/** @type {Map<number, Cell>} */
			let pellets = new Map();
			if (sync.merge) {
				({ cells, pellets } = sync.merge);
			} else {
				sync.merge = { cells, pellets };
			}

			// #1 : collect local changes
			all.clear();
			for (const [id, cell] of world.cells)
				all.set(id, [0, cell]);

			// #2 : check if all the important cells are synced
			/** @type {number} */
			let otherOffset;
			/**
			 * @param {Cell} cell
			 * @returns {boolean}
			 */
			const check = cell => {
				const currentSet = all.get(cell.id);
				if (!currentSet) {
					all.set(cell.id, [otherOffset, cell]);
					return true;
				}

				const [currentOffset, current] = currentSet;
				const currentDisappearedAt = (current.deadAt !== undefined && current.deadTo === -1)
					? currentOffset + current.deadAt : undefined;
				const cellDisappearedAt
					= (cell.deadAt !== undefined && cell.deadTo === -1) ? otherOffset + cell.deadAt : undefined;

				if (currentDisappearedAt === undefined && cellDisappearedAt === undefined) {
					// if *neither* cell has disappeared, check for desync
					if (current.nx !== cell.nx || current.ny !== cell.ny || current.nr !== cell.nr)
						return false;
				} else if (currentDisappearedAt === undefined && cellDisappearedAt !== undefined) {
					// other disappeared; prefer the current one
				} else if (currentDisappearedAt !== undefined && cellDisappearedAt === undefined) {
					// current disappeared; prefer the other one
					all.set(cell.id, [currentOffset, cell]);
				} else {
					// both have disappeared, prefer the one that disappeared later
					if (/** @type {number} */(currentDisappearedAt) < /** @type {number} */(cellDisappearedAt))
						all.set(cell.id, [otherOffset, cell]);
				}

				return true;
			};

			/**
			 * @param {'cells' | 'pellets'} key
			 * @returns {boolean}
			 */
			const iterate = key => {
				for (const data of sync.others.values()) {
					otherOffset = data.updated.timeOrigin - performance.timeOrigin;
					const otherNow = otherOffset + data.updated.now;
					if (now - otherNow > 250) continue; // tab has not updated in 250ms, disregard it
					if (!data.cells) continue;
					for (const cell of data.cells[key].values()) {
						if (!check(cell)) return false;
					}
				}

				return true;
			};

			if (!iterate('cells'))
				return;

			// #3 : then, check if all the pellets are synced
			for (const [id, cell] of world.pellets)
				all.set(id, [0, cell]);
			if (!iterate('pellets'))
				return;

			// #4 : all tabs are synced, we can update the cells
			for (const [offset, cell] of all.values()) {
				const old = pellets.get(cell.id) ?? cells.get(cell.id);
				if (old) {
					const { x, y, r, jx, jy, jr } = world.xyr(old, sync.merge, now);
					old.ox = x; old.oy = y; old.or = r;
					old.jx = jx; old.jy = jy; old.jr = jr;
					old.nx = cell.nx; old.ny = cell.ny; old.nr = cell.nr;

					if (cell.deadAt !== undefined) {
						if (old.deadAt === undefined) {
							old.deadAt = now;
							old.deadTo = cell.deadTo;
						}
					} else if (old.deadAt !== undefined) {
						old.ox = old.jx = old.nx;
						old.oy = old.jy = old.ny;
						old.or = old.jr = old.nr;
						old.deadTo = -1;
						old.deadAt = undefined;
					}
					old.updated = now;
				} else {
					/** @type {Cell} */
					const ncell = {
						id: cell.id,
						ox: cell.ox, nx: cell.nx, jx: cell.jx,
						oy: cell.oy, ny: cell.ny, jy: cell.jy,
						or: cell.or, nr: cell.nr, jr: cell.jr,
						Rgb: cell.Rgb, rGb: cell.rGb, rgB: cell.rgB,
						jagged: cell.jagged,
						name: cell.name, skin: cell.skin, sub: cell.sub, clan: cell.clan,
						born: offset + cell.born, updated: now,
						deadTo: cell.deadTo,
						deadAt: cell.deadAt !== undefined ? now : undefined,
					};

					if (cell.nr <= 20)
						pellets.set(cell.id, ncell);
					else
						cells.set(cell.id, ncell);
				}
			}

			// #5 : kill cells that aren't seen anymore
			/**
			 * @param {Map<number, Cell>} map
			 * @param {number} id
			 * @param {Cell} cell
			 */
			const clean = (map, id, cell) => {
				if (all.has(id)) return;
				if (cell.deadAt !== undefined) {
					if (now - cell.deadAt > 1000) map.delete(id);
				} else {
					cell.deadAt = now;
					cell.deadTo = -1;
					cell.updated = now;
				}
			};

			for (const [id, cell] of cells) clean(cells, id, cell);
			for (const [id, cell] of pellets) clean(pellets, id, cell);
		};

		return sync;
	})();



	///////////////////////////
	// Setup World Variables //
	///////////////////////////
	/** @typedef {{
	 * id: number,
	 * ox: number, nx: number, jx: number,
	 * oy: number, ny: number, jy: number,
	 * or: number, nr: number, jr: number,
	 * Rgb: number, rGb: number, rgB: number,
	 * updated: number, born: number, deadTo: number, deadAt: number | undefined,
	 * jagged: boolean,
	 * name: string, skin: string, sub: boolean, clan: string,
	 * }} Cell */
	const world = (() => {
		const world = {};

		// #1 : define cell variables and functions
		/** @type {Map<number, Cell>} */
		world.cells = new Map();
		/** @type {Set<Cell>} */
		world.clanmates = new Set();
		/** @type {number[]} */
		world.mine = []; // order matters, as the oldest cells split first
		/** @type {Set<number>} */
		world.mineDead = new Set();
		/** @type {Map<number, Cell>} */
		world.pellets = new Map();

		/**
		 * @param {Cell} cell
		 * @param {{ cells: Map<number, Cell>, pellets: Map<number, Cell> }} map
		 * @param {number} now
		 * @returns {{ x: number, y: number, r: number, jx: number, jy: number, jr: number }}
		 */
		world.xyr = (cell, map, now) => {
			let a = (now - cell.updated) / settings.drawDelay;
			a = a < 0 ? 0 : a > 1 ? 1 : a;
			let nx = cell.nx;
			let ny = cell.ny;
			if (cell.deadAt !== undefined && cell.deadTo !== -1) { // check deadTo to avoid unnecessary map lookup
				const killer = map.cells.get(cell.deadTo) ?? map.pellets.get(cell.deadTo);
				if (killer && (killer.deadAt === undefined || cell.deadAt <= killer.deadAt)) {
					// do not animate death towards a cell that died already (went offscreen)
					nx = killer.nx;
					ny = killer.ny;
				}
			}

			const x = cell.ox + (nx - cell.ox) * a;
			const y = cell.oy + (ny - cell.oy) * a;
			const r = cell.or + (cell.nr - cell.or) * a;

			const dt = (now - cell.updated) / 1000;
			return {
				x, y, r,
				jx: aux.exponentialEase(cell.jx, x, 2, dt),
				jy: aux.exponentialEase(cell.jy, y, 2, dt),
				jr: aux.exponentialEase(cell.jr, r, 5, dt),
			};
		};

		let last = performance.now();
		world.update = function () {
			const now = performance.now();
			const dt = (now - last) / 1000;
			last = now;

			const jellyPhysics = aux.setting('input#jellyPhysics', false);
			const map = (settings.mergeViewArea && sync.merge) ? sync.merge : world;
			const weight = settings.mergeCamera ? settings.mergeCameraWeight : 0;

			/**
			 * @param {Iterable<number>} owned
			 * @param {Map<number, {
			 * 	x: number, y: number, r: number, jx: number, jy: number, jr: number
			 * } | false> | undefined} fallback
			 * @returns {{
			 * 	weightedX: number, weightedY: number, totalWeight: number,
			 * 	scale: number, width: number, height: number
			 * }}
			 */
			const cameraDesc = (owned, fallback) => {
				let weightedX = 0;
				let weightedY = 0;
				let totalWeight = 0;
				let totalR = 0;

				for (const id of owned) {
					/** @type {{ x: number, y: number, r: number, jx: number, jy: number, jr: number }} */
					let xyr;

					const cell = map.cells.get(id);
					if (!cell) {
						const partial = fallback?.get(id);
						if (!partial) continue;
						xyr = partial;
					} else if (cell.deadAt !== undefined) continue;
					else xyr = world.xyr(cell, map, now);

					if (jellyPhysics) {
						const weighted = xyr.jr ** weight;
						weightedX += xyr.jx * weighted;
						weightedY += xyr.jy * weighted;
						totalWeight += weighted;
						totalR += xyr.jr;
					} else {
						const weighted = xyr.r ** weight;
						weightedX += xyr.x * weighted;
						weightedY += xyr.y * weighted;
						totalWeight += weighted;
						totalR += xyr.r;
					}
				}

				const scale = Math.min(64 / totalR, 1) ** 0.4;
				const width = 1920 / 2 / scale;
				const height = 1080 / 2 / scale;

				return { weightedX, weightedY, totalWeight, scale, width, height };
			};

			const localDesc = cameraDesc(world.mine, undefined);
			let { weightedX, weightedY, totalWeight } = localDesc;
			const localX = weightedX / totalWeight;
			const localY = weightedY / totalWeight;
			/** @type {number} */
			let zoomout;

			world.camera.merged = false;
			if (settings.mergeCamera) {
				zoomout = 0.25;
				if (localDesc.totalWeight > 0) {
					for (const data of sync.others.values()) {
						const thisDesc = cameraDesc(data.owned.keys(), data.owned);
						if (thisDesc.totalWeight <= 0) continue;
						const thisX = thisDesc.weightedX / thisDesc.totalWeight;
						const thisY = thisDesc.weightedY / thisDesc.totalWeight;

						if (Math.abs(thisX - localX) < localDesc.width + thisDesc.width + 1000
							&& Math.abs(thisY - localY) < localDesc.height + thisDesc.height + 1000) {
							weightedX += thisDesc.weightedX;
							weightedY += thisDesc.weightedY;
							totalWeight += thisDesc.totalWeight;
							world.camera.merged = true;
						}
					}
				}
			} else {
				zoomout = localDesc.scale;
			}

			let xyEaseFactor;
			if (totalWeight > 0) {
				world.camera.tx = weightedX / totalWeight;
				world.camera.ty = weightedY / totalWeight;
				world.camera.tscale = zoomout * input.zoom;

				xyEaseFactor = 2;
			} else {
				xyEaseFactor = 20;
			}

			world.camera.x = aux.exponentialEase(world.camera.x, world.camera.tx, xyEaseFactor, dt);
			world.camera.y = aux.exponentialEase(world.camera.y, world.camera.ty, xyEaseFactor, dt);
			world.camera.scale = aux.exponentialEase(world.camera.scale, world.camera.tscale, 9, dt);
		};

		// clean up dead cells
		world.clean = () => {
			const now = performance.now();
			for (const [id, cell] of world.cells) {
				if (cell.deadAt === undefined) continue;
				if (now - cell.deadAt >= settings.drawDelay) {
					world.cells.delete(id);
					world.mineDead.delete(id);
				}
			}

			for (const [id, cell] of world.pellets) {
				if (cell.deadAt === undefined) continue;
				if (now - cell.deadAt >= settings.drawDelay)
					world.pellets.delete(id);
			}

			wasm['tab.cleanup'](0, now);
		};



		// #2 : define others, like camera and borders
		world.camera = {
			x: 0, tx: 0,
			y: 0, ty: 0,
			scale: 1, tscale: 1,
			merged: false,
		};

		/** @type {{ l: number, r: number, t: number, b: number } | undefined} */
		world.border = undefined;

		/** @type {{ name: string, me: boolean, sub: boolean, place: number | undefined }[]} */
		world.leaderboard = [];



		// #3 : define stats
		world.stats = {
			foodEaten: 0,
			highestPosition: 200,
			highestScore: 0,
			/** @type {number | undefined} */
			spawnedAt: undefined,
		};



		return world;
	})();



	//////////////////////////
	// Setup All Networking //
	//////////////////////////
	const net = (() => {
		const net = {};

		// #1 : define state
		/** @type {{ shuffle: Map<number, number>, unshuffle: Map<number, number> } | undefined} */
		let handshake;
		/** @type {number | undefined} */
		let pendingPingFrom;
		let pingInterval;
		let wasOpen = false;
		/** @type {WebSocket} */
		let ws;

		/** -1 if ping reply took too long @type {number | undefined} */
		net.latency = undefined;
		net.ready = false;
		net.rejected = false;

		// #2 : connecting/reconnecting the websocket
		/** @type {HTMLSelectElement | null} */
		const gamemode = document.querySelector('#gamemode');
		/** @type {HTMLOptionElement | null} */
		const firstGamemode = document.querySelector('#gamemode option');

		net.url = () => {
			let server = 'wss://' + (gamemode?.value || firstGamemode?.value || 'ca0.sigmally.com/ws/');
			if (location.search.startsWith('?ip='))
				server = location.search.slice('?ip='.length);

			return server;
		};

		function connect() {
			try {
				ws = new destructor.realWebSocket(net.url());
			} catch (err) {
				console.error('can\'t make WebSocket:', err);
				aux.require(null, 'The server is invalid. Try changing the server, reloading the page, or clearing ' +
					'your browser cache and cookies.');
			}

			destructor.safeWebSockets.add(ws);
			ws.binaryType = 'arraybuffer';
			ws.addEventListener('close', wsClose);
			ws.addEventListener('error', wsError);
			ws.addEventListener('message', wsMessage);
			ws.addEventListener('open', wsOpen);
		}

		function wsClose() {
			handshake = undefined;
			pendingPingFrom = undefined;
			if (pingInterval)
				clearInterval(pingInterval);

			net.latency = undefined;
			net.ready = false;
			if (!wasOpen) net.rejected = true;
			wasOpen = false;

			// hide/clear UI
			ui.stats.misc.textContent = '';
			world.leaderboard = [];
			ui.leaderboard.update();

			// clear world
			world.border = undefined;
			world.cells.clear(); // make sure we won't see overlapping IDs from new cells from the new connection
			world.pellets.clear();
			world.clanmates.clear();
			while (world.mine.length) world.mine.pop();
			world.mineDead.clear();
			sync.broadcast(performance.now());
		}

		let reconnectAttempts = 0;
		/** @type {number | undefined} */
		let willReconnectAt;
		setInterval(() => {
			// retry after 500, 1000, 1500, 3000ms of closing
			// OR if a captcha was (very recently) accepted
			if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED)
				return;

			const now = performance.now();
			if (input.captchaAcceptedAt && now - input.captchaAcceptedAt <= 3000) {
				willReconnectAt = undefined;
				connect();
				return;
			}

			if (willReconnectAt === undefined) {
				willReconnectAt = now + Math.min(500 * ++reconnectAttempts, 3000);
			} else if (now >= willReconnectAt) {
				willReconnectAt = undefined;
				connect();
			}
		}, 50);

		/** @param {Event} err */
		function wsError(err) {
			console.error('WebSocket error:', err);
		}

		function wsOpen() {
			net.rejected = false;
			wasOpen = true;
			reconnectAttempts = 0;

			ui.chat.barrier();

			// reset camera location to the middle; this is implied but never sent by the server
			world.camera.x = world.camera.tx = 0;
			world.camera.y = world.camera.ty = 0;
			world.camera.scale = world.camera.tscale = 1;

			ws.send(aux.textEncoder.encode('SIG 0.0.1\x00'));
		}

		// listen for when the gamemode changes
		gamemode?.addEventListener('change', () => {
			ws.close();
		});



		// #3 : set up auxiliary functions
		/**
		 * @param {DataView} dat
		 * @param {number} off
		 * @returns {[string, number]}
		 */
		function readZTString(dat, off) {
			const startOff = off;
			for (; off < dat.byteLength; ++off) {
				if (dat.getUint8(off) === 0) break;
			}

			return [aux.textDecoder.decode(dat.buffer.slice(startOff, off)), off + 1];
		}

		/**
		 * @param {number} opcode
		 * @param {object} data
		 */
		function sendJson(opcode, data) {
			if (!handshake) return;
			const dataBuf = aux.textEncoder.encode(JSON.stringify(data));
			const buf = new ArrayBuffer(dataBuf.byteLength + 2);
			const dat = new DataView(buf);

			dat.setUint8(0, Number(handshake.shuffle.get(opcode)));
			for (let i = 0; i < dataBuf.byteLength; ++i) {
				dat.setUint8(1 + i, dataBuf[i]);
			}

			ws.send(buf);
		}

		function createPingLoop() {
			function ping() {
				if (!handshake) return; // shouldn't ever happen

				if (pendingPingFrom !== undefined) {
					// ping was not replied to, tell the player the ping text might be wonky for a bit
					net.latency = -1;
				}

				ws.send(new Uint8Array([Number(handshake.shuffle.get(0xfe))]));
				pendingPingFrom = performance.now();
			}

			pingInterval = setInterval(ping, 2_000);
		}



		// #4 : set up message handler
		/** @param {MessageEvent} msg */
		function wsMessage(msg) {
			const dat = new DataView(msg.data);
			if (!handshake) {
				// unlikely to change as we're still on v0.0.1 but i'll check it anyway
				let [version, off] = readZTString(dat, 0);
				if (version !== 'SIG 0.0.1') {
					alert(`got unsupported version "${version}", expected "SIG 0.0.1"`);
					return ws.close();
				}

				handshake = { shuffle: new Map(), unshuffle: new Map() };
				for (let i = 0; i < 256; ++i) {
					const shuffled = dat.getUint8(off + i);
					handshake.shuffle.set(i, shuffled);
					handshake.unshuffle.set(shuffled, i);
				}

				createPingLoop();

				return;
			}

			const now = performance.now();
			let off = 1;
			switch (handshake.unshuffle.get(dat.getUint8(0))) {
				case 0x10: { // world update
					// TEMP TEST PROCESSING TODO
					const wasmDat = new DataView(wasm.imports.main.memory.buffer);
					for (let i = 0; i < dat.byteLength; ++i) {
						wasmDat.setUint8(i, dat.getUint8(i));
					}
					void wasm['ws.handle_update'](0, performance.now());

					world.clean();
					break;
				}

				case 0x11: { // update camera pos
					world.camera.tx = dat.getFloat32(off, true);
					world.camera.ty = dat.getFloat32(off + 4, true);
					world.camera.tscale = dat.getFloat32(off + 8, true) * input.zoom;
					break;
				}

				case 0x12: // delete all cells
					for (const cell of world.cells.values()) {
						if (cell.deadAt === undefined) {
							cell.deadAt = now;
							cell.deadTo = -1;
						}
					}

					for (const cell of world.pellets.values()) {
						if (cell.deadAt === undefined) {
							cell.deadAt = now;
							cell.deadTo = -1;
						}
					}

					world.clanmates.clear();
				// passthrough
				case 0x14: // delete my cells
					while (world.mine.length) world.mine.pop();
					break;

				case 0x20: { // new owned cell
					world.mine.push(dat.getUint32(off, true));
					if (world.mine.length === 1)
						world.stats.spawnedAt = now;
					break;
				}

				// case 0x30 is a text list (not a numbered list), leave unsupported
				case 0x31: { // ffa leaderboard list
					const lb = [];
					const count = dat.getUint32(off, true);
					off += 4;

					let myPosition;
					for (let i = 0; i < count; ++i) {
						const me = !!dat.getUint32(off, true);
						off += 4;

						let name;
						[name, off] = readZTString(dat, off);
						name = aux.parseName(name);

						// why this is copied into every leaderboard entry is beyond my understanding
						myPosition = dat.getUint32(off, true);
						const sub = !!dat.getUint32(off + 4, true);
						off += 8;

						lb.push({ name, sub, me, place: undefined });
					}

					if (myPosition) {
						if (myPosition - 1 >= lb.length) {
							/** @type {HTMLInputElement | null} */
							const inputName = document.querySelector('input#nick');
							lb.push({
								me: true,
								name: aux.parseName(inputName?.value ?? ''),
								place: myPosition,
								sub: false,
							});
						}

						if (myPosition < world.stats.highestPosition)
							world.stats.highestPosition = myPosition;
					}

					world.leaderboard = lb;
					ui.leaderboard.update();
					break;
				}

				case 0x40: { // border update
					world.border = {
						l: dat.getFloat64(off, true),
						t: dat.getFloat64(off + 8, true),
						r: dat.getFloat64(off + 16, true),
						b: dat.getFloat64(off + 24, true),
					};
					break;
				}

				case 0x63: { // chat message
					const flags = dat.getUint8(off);
					const rgb = /** @type {[number, number, number, number]} */
						([dat.getUint8(off + 1) / 255, dat.getUint8(off + 2) / 255, dat.getUint8(off + 3) / 255, 1]);
					off += 4;

					let name;
					[name, off] = readZTString(dat, off);
					let msg;
					[msg, off] = readZTString(dat, off);

					ui.chat.add(name, rgb, msg);
					break;
				}

				case 0xb4: { // incorrect password alert
					ui.error('Password is incorrect');
					break;
				}

				case 0xdd: {
					net.howarewelosingmoney();
					net.ready = true;
					break;
				}

				case 0xfe: { // server stats, response to a ping
					let statString;
					[statString, off] = readZTString(dat, off);

					const statData = JSON.parse(statString);
					ui.stats.update(statData);

					if (pendingPingFrom) {
						net.latency = now - pendingPingFrom;
						pendingPingFrom = undefined;
					}
					break;
				}
			}
		}



		// #5 : export input functions
		/**
		 * @param {number} x
		 * @param {number} y
		 */
		net.move = function (x, y) {
			if (!handshake) return;
			const buf = new ArrayBuffer(13);
			const dat = new DataView(buf);

			dat.setUint8(0, Number(handshake.shuffle.get(0x10)));
			dat.setInt32(1, x, true);
			dat.setInt32(5, y, true);

			ws.send(buf);
		};

		net.w = function () {
			if (!handshake) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(21))]));
		};

		net.qdown = function () {
			if (!handshake) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(18))]));
		};

		net.qup = function () {
			if (!handshake) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(19))]));
		};

		net.split = function () {
			if (!handshake) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(17))]));
		};

		/**
		 * @param {string} msg
		 */
		net.chat = function (msg) {
			if (!handshake) return;
			const msgBuf = aux.textEncoder.encode(msg);

			const buf = new ArrayBuffer(msgBuf.byteLength + 3);
			const dat = new DataView(buf);

			dat.setUint8(0, Number(handshake.shuffle.get(0x63)));
			// skip byte #1, seems to require authentication + not implemented anyway
			for (let i = 0; i < msgBuf.byteLength; ++i)
				dat.setUint8(2 + i, msgBuf[i]);

			ws.send(buf);
		};

		/**
		 * @param {{ name: string, skin: string, [x: string]: any }} data
		 */
		net.play = function (data) {
			sendJson(0x00, data);
		};

		net.howarewelosingmoney = function () {
			if (!handshake) return;
			// this is a new thing added with the rest of the recent source code obfuscation (2024/02/18)
			// which collects and links to your sigmally account, seemingly just for light data analysis but probably
			// just for the fun of it:
			// - your IP and country
			// - whether you are under a proxy
			// - whether you are using sigmod (because it also blocks ads)
			// - whether you are using a traditional adblocker
			//
			// so, no thank you
			sendJson(0xd0, { ip: '', country: '', proxy: false, user: null, blocker: 'sigmally fixes @8y8x' });
		};

		net.connection = function () {
			if (!ws) return undefined;
			if (ws.readyState !== WebSocket.OPEN) return undefined;
			if (!handshake) return undefined;
			return ws;
		};



		connect();
		return net;
	})();



	//////////////////////////
	// Setup Input Handlers //
	//////////////////////////
	const input = (() => {
		const input = {};

		// #1 : general inputs
		/** @type {number | undefined} */
		let lastMouseX = undefined;
		/** @type {number | undefined} */
		let lastMouseY = undefined;
		let mouseX = 0; // -1 <= mouseX <= 1
		let mouseY = 0; // -1 <= mouseY <= 1
		let forceW = false;
		let w = false;

		input.zoom = 1;

		/** @returns [number, number] */
		input.mouse = () => {
			return [
				world.camera.x + mouseX * (innerWidth / innerHeight) * 540 / world.camera.scale,
				world.camera.y + mouseY * 540 / world.camera.scale,
			];
		};

		function mouse() {
			const [x, y] = input.mouse();
			net.move(x, y);
			lastMouseX = mouseX;
			lastMouseY = mouseY;
		}

		function unfocused() {
			return ui.escOverlayVisible() || document.activeElement?.tagName === 'INPUT';
		}

		let lastMovement = performance.now();
		input.move = () => {
			// called every frame because tabbing out reduces setInterval frequency, which messes up mouse flick fixes
			const now = performance.now();
			if (now - lastMovement < 40) return;
			lastMovement = now;

			// if holding w with sigmod, tabbing out, then tabbing in, avoid spitting out only one W
			const consumedForceW = forceW;
			forceW = false;

			// allow flicking mouse then immediately switching tabs in the same tick
			if (document.visibilityState === 'hidden' && lastMouseX === mouseX && lastMouseY === mouseY) return;
			mouse();

			if (consumedForceW || w) net.w();
		};

		// anti-afk when another tab is playing
		let lastCheck = performance.now();
		input.antiAfk = () => {
			const now = performance.now();
			// only check every 10s, don't want to spam packets but don't want to miss resetting the afk timer
			if (now - lastCheck < 10_000) return;
			lastCheck = now;

			let anyAlive = false;
			sync.others.forEach(data => anyAlive ||= data.owned.size > 0);
			if (anyAlive) net.qup(); // send literally any packet at all
		};

		// sigmod freezes the player by overlaying an invisible div, so we just listen for canvas movements instead
		addEventListener('mousemove', e => {
			if (ui.escOverlayVisible()) return;
			// sigmod freezes the player by overlaying an invisible div, so we respect it
			if (e.target instanceof HTMLDivElement
				&& /** @type {CSSUnitValue | undefined} */ (e.target.attributeStyleMap.get('z-index'))?.value === 99)
				return;
			mouseX = (e.clientX / innerWidth * 2) - 1;
			mouseY = (e.clientY / innerHeight * 2) - 1;
		});

		addEventListener('wheel', e => {
			if (unfocused()) return;
			input.zoom *= 0.8 ** (e.deltaY / 100 * settings.scrollFactor);
			input.zoom = Math.min(Math.max(input.zoom, 0.8 ** 10), 0.8 ** -11);
			sync.zoom();
		});

		addEventListener('keydown', e => {
			if (!document.hasFocus()) return;

			if (e.code === 'Escape') {
				if (document.activeElement === ui.chat.input)
					ui.chat.input.blur();
				else
					ui.toggleEscOverlay();
				return;
			}

			if (unfocused()) {
				if (e.code === 'Enter' && document.activeElement === ui.chat.input && ui.chat.input.value.length > 0) {
					net.chat(ui.chat.input.value.slice(0, 15));
					ui.chat.input.value = '';
					ui.chat.input.blur();
				}

				return;
			}

			switch (e.code) {
				case 'KeyQ':
					if (!e.repeat)
						net.qdown();
					break;
				case 'KeyW':
					forceW = true;
					w = true;
					break;
				case 'Space': {
					if (!e.repeat) {
						// send mouse position immediately, so the split will go in the correct direction.
						// setTimeout is used to ensure that our mouse position is actually updated (it comes after
						// keydown events)
						setTimeout(() => {
							mouse();
							net.split();
						});
					}
					break;
				}
				case 'Enter': {
					ui.chat.input.focus();
					break;
				}
			}

			if (e.ctrlKey && e.code === 'Tab') {
				e.returnValue = true; // undo e.preventDefault() by SigMod
				e.stopImmediatePropagation(); // prevent SigMod from calling e.preventDefault() afterwards
			} else if (settings.blockBrowserKeybinds && e.code !== 'F11')
				e.preventDefault();
			else if ((e.ctrlKey && e.code === 'KeyW') || e.code === 'Tab')
				e.preventDefault();
		});

		addEventListener('keyup', e => {
			// do not check if unfocused
			if (e.code === 'KeyQ')
				net.qup();
			else if (e.code === 'KeyW')
				w = false;
		});

		// when switching tabs, make sure W is not being held
		addEventListener('blur', () => {
			// force sigmod to get the signal
			if (aux.sigmodSettings?.rapidFeedKey)
				document.dispatchEvent(new KeyboardEvent('keyup', { key: aux.sigmodSettings.rapidFeedKey }));

			w = false;
		});

		addEventListener('beforeunload', e => {
			e.preventDefault();
		});

		// prevent right clicking on the game
		ui.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

		// prevent dragging when some things are selected - i have a habit of unconsciously clicking all the time,
		// making me regularly drag text, disabling my mouse inputs for a bit
		addEventListener('dragstart', e => e.preventDefault());



		// #2 : play and spectate buttons, and captcha
		/** @param {boolean} spectating */
		function playData(spectating) {
			/** @type {HTMLInputElement | null} */
			const nickElement = document.querySelector('input#nick');
			/** @type {HTMLInputElement | null} */
			const password = document.querySelector('input#password');

			return {
				state: spectating ? 2 : undefined,
				name: nickElement?.value ?? '',
				skin: aux.settings?.skin,
				token: aux.token?.token,
				sub: (aux.userData?.subscription ?? 0) > Date.now(),
				clan: aux.userData?.clan,
				showClanmates: aux.setting('input#showClanmates', true),
				password: password?.value,
			};
		}

		/** @type {HTMLButtonElement} */
		const play = aux.require(
			document.querySelector('button#play-btn'),
			'Can\'t find the play button. Try reloading the page?',
		);
		/** @type {HTMLButtonElement} */
		const spectate = aux.require(
			document.querySelector('button#spectate-btn'),
			'Can\'t find the spectate button. Try reloading the page?',
		);

		play.disabled = spectate.disabled = true;
		const playText = play.textContent;

		(async () => {
			const mount = document.createElement('div');
			mount.id = 'sf-captcha-mount';
			mount.style.display = 'none';
			play.parentNode?.insertBefore(mount, play);

			/** @type {Set<() => void> | undefined} */
			let onGrecaptchaReady = new Set();
			/** @type {Set<() => void> | undefined} */
			let onTurnstileReady = new Set();
			let grecaptcha, turnstile, CAPTCHA2, CAPTCHA3, TURNSTILE;

			let readyCheck;
			readyCheck = setInterval(() => {
				// it's possible that recaptcha or turnstile may be removed in the future, so we be redundant to stay
				// safe
				if (onGrecaptchaReady) {
					({ grecaptcha, CAPTCHA2, CAPTCHA3 } = /** @type {any} */ (window));
					if (grecaptcha?.ready && CAPTCHA2 && CAPTCHA3) {
						const handlers = onGrecaptchaReady;
						onGrecaptchaReady = undefined;

						grecaptcha.ready(() => {
							handlers.forEach(cb => cb());
							// prevent game.js from using grecaptcha and messing things up
							({ grecaptcha } = /** @type {any} */ (window));
							/** @type {any} */ (window).grecaptcha = {
								execute: () => { },
								ready: () => { },
								render: () => { },
								reset: () => { },
							};
						});
					}
				}

				if (onTurnstileReady) {
					({ turnstile, TURNSTILE } = /** @type {any} */ (window));
					if (turnstile?.ready && TURNSTILE) {
						const handlers = onTurnstileReady;
						onTurnstileReady = undefined;
						handlers.forEach(cb => cb());

						// prevent game.js from using turnstile and messing things up
						/** @type {any} */ (window).turnstile = {
							execute: () => { },
							ready: () => { },
							render: () => { },
							reset: () => { },
						};
					}
				}

				if (!onGrecaptchaReady && !onTurnstileReady)
					clearInterval(readyCheck);
			}, 50);

			/**
			 * @param {string} url
			 * @returns {Promise<string>}
			 */
			const tokenVariant = async url => {
				const host = new URL(url).host;
				if (host.includes('sigmally.com'))
					return aux.oldFetch(`https://${host}/server/recaptcha/v3`)
						.then(res => res.json())
						.then(res => res.version ?? 'none');
				else
					return Promise.resolve('none');
			};

			/** @type {unique symbol} */
			const used = Symbol();
			/** @type {unique symbol} */
			const waiting = Symbol();
			/** @type {undefined | typeof waiting | typeof used
			 * | { variant: string, token: string | undefined }} */
			let token = undefined;
			/** @type {string | undefined} */
			let turnstileHandle;
			/** @type {number | undefined} */
			let v2Handle;

			input.captchaAcceptedAt = undefined;

			/**
			 * @param {string} url
			 * @param {string} variant
			 * @param {string | undefined} captchaToken
			 */
			const publishToken = (url, variant, captchaToken) => {
				const url2 = net.url();
				play.textContent = `${playText} (validating)`;
				if (url === url2) {
					const host = new URL(url).host;
					aux.oldFetch(`https://${host}/server/recaptcha/v3`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ token: captchaToken }),
					})
						.then(res => res.json())
						.then(res => {
							if (res.status === 'complete') {
								token = used;
								play.disabled = spectate.disabled = false;
								play.textContent = playText;
								input.captchaAcceptedAt = performance.now();
								net.rejected = false; // wait until we try connecting again
							}
						})
						.catch(err => {
							play.textContent = playText;
							token = undefined;
							throw err;
						});
				} else {
					token = { variant, token: captchaToken };
				}
			};

			setInterval(() => {
				const canPlay = !net.rejected && net.connection()?.readyState === WebSocket.OPEN;
				if (play.disabled !== !canPlay) {
					play.disabled = spectate.disabled = !canPlay;
					play.textContent = playText;
				}

				if (token === waiting) return;
				if (!net.rejected) return;

				const url = net.url();

				if (typeof token !== 'object') {
					// get a new token if first time, or if we're on a new connection now
					token = waiting;
					play.disabled = spectate.disabled = true;
					play.textContent = `${playText} (getting type)`;
					tokenVariant(url)
						.then(async variant => {
							const url2 = net.url();
							if (url !== url2) {
								// server changed and may want a different variant; restart
								token = undefined;
								return;
							}

							if (variant === 'v2') {
								mount.style.display = 'block';
								play.style.display = spectate.style.display = 'none';
								play.textContent = playText;
								if (v2Handle !== undefined) {
									grecaptcha.reset(v2Handle);
								} else {
									const cb = () => void (v2Handle = grecaptcha.render('sf-captcha-mount', {
										sitekey: CAPTCHA2,
										callback: v2 => {
											mount.style.display = 'none';
											play.style.display = spectate.style.display = '';
											publishToken(url, variant, v2);
										},
									}));
									if (onGrecaptchaReady)
										onGrecaptchaReady.add(cb);
									else
										grecaptcha.ready(cb);
								}
							} else if (variant === 'v3') {
								play.textContent = `${playText} (solving)`;
								const cb = () => grecaptcha.execute(CAPTCHA3)
									.then(v3 => publishToken(url, variant, v3));
								if (onGrecaptchaReady)
									onGrecaptchaReady.add(cb);
								else
									grecaptcha.ready(cb);
							} else if (variant === 'turnstile') {
								mount.style.display = 'block';
								play.style.display = spectate.style.display = 'none';
								play.textContent = playText;
								if (turnstileHandle !== undefined) {
									turnstile.reset(turnstileHandle);
								} else {
									const cb = () => void (turnstileHandle = turnstile.render('#sf-captcha-mount', {
										sitekey: TURNSTILE,
										callback: turnstileToken => {
											mount.style.display = 'none';
											play.style.display = spectate.style.display = '';
											publishToken(url, variant, turnstileToken);
										},
									}));
									if (onTurnstileReady)
										onTurnstileReady.add(cb);
									else
										cb();
								}
							} else {
								// server wants "none" or unknown token variant; don't show a captcha
								publishToken(url, variant, undefined);
								play.disabled = spectate.disabled = false;
								play.textContent = playText;
							}
						}).catch(err => {
							token = undefined;
							console.warn('Error while getting token variant:', err);
						});
				} else {
					// token is ready to be used, check variant
					const got = token;
					token = waiting;
					play.disabled = spectate.disabled = true;
					play.textContent = `${playText} (getting type)`;
					tokenVariant(url)
						.then(variant2 => {
							if (got.variant !== variant2) {
								// server wants a different token variant
								token = undefined;
							} else
								publishToken(url, got.variant, got.token);
						}).catch(err => {
							token = got;
							console.warn('Error while getting token variant:', err);
						});
				}
			}, 100);

			/** @param {MouseEvent} e */
			async function clickHandler(e) {
				if (net.connection() && !net.rejected) {
					ui.toggleEscOverlay(false);
					net.play(playData(e.currentTarget === spectate));
				}
			}

			play.addEventListener('click', clickHandler);
			spectate.addEventListener('click', clickHandler);
		})();

		return input;
	})();



	//////////////////////////
	// Configure WebGL Data //
	//////////////////////////
	const { init: initWebGL, programs, uniforms } = (() => {
		// note: WebGL functions only really return null if the context is lost - in which case, data will be replaced
		// anyway after it's restored. so, we cast everything to a non-null type.
		const programs = {};
		const uniforms = {};

		const gl = ui.game.gl;

		// define helper functions
		/**
		 * @param {string} name
		 * @param {WebGLShader} vShader
		 * @param {WebGLShader} fShader
		 */
		function program(name, vShader, fShader) {
			const p = /** @type {WebGLProgram} */ (gl.createProgram());

			gl.attachShader(p, vShader);
			gl.attachShader(p, fShader);
			gl.linkProgram(p);

			// note: linking errors should not happen in production
			aux.require(
				gl.getProgramParameter(p, gl.LINK_STATUS) || gl.isContextLost(),
				`Can\'t link WebGL2 program "${name}". You might be on a weird browser.\n\nFull error log:\n` +
				gl.getProgramInfoLog(p),
			);

			return p;
		}

		/**
		 * @param {string} name
		 * @param {number} type
		 * @param {string} source
		 */
		function shader(name, type, source) {
			const s = /** @type {WebGLShader} */ (gl.createShader(type));
			gl.shaderSource(s, source);
			gl.compileShader(s);

			// note: compilation errors should not happen in production
			aux.require(
				gl.getShaderParameter(s, gl.COMPILE_STATUS) || gl.isContextLost(),
				`Can\'t compile WebGL2 shader "${name}". You might be on a weird browser.\n\nFull error log:\n` +
				gl.getShaderInfoLog(s),
			);

			return s;
		}

		/**
		 * @template {string} T
		 * @param {string} programName
		 * @param {WebGLProgram} program
		 * @param {T[]} names
		 * @returns {{ [x in T]: WebGLUniformLocation }}
		 */
		function getUniforms(programName, program, names) {
			/** @type {{ [x in T]?: WebGLUniformLocation }} */
			const uniforms = {};
			names.forEach(name => {
				const loc = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(program, name));
				aux.require(
					loc || !gl.isContextLost(), `Can\'t find WebGL2 uniform "${name}" in program "${programName}".`);

				uniforms[name] = loc;
			});

			return /** @type {any} */ (uniforms);
		}

		let nextUboBinding = 0;
		/**
		 * @param {WebGLProgram} program
		 * @param {string} blockName
		 */
		const ubo = (program, blockName) => {
			const index = gl.getUniformBlockIndex(program, blockName);
			const size = gl.getActiveUniformBlockParameter(program, index, gl.UNIFORM_BLOCK_DATA_SIZE);

			const ubo = gl.createBuffer();
			gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
			gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW);
			gl.uniformBlockBinding(program, index, nextUboBinding);
			gl.bindBufferBase(gl.UNIFORM_BUFFER, nextUboBinding, ubo);
			++nextUboBinding;
			return ubo;
		};



		function init() {
			nextUboBinding = 0;

			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

			// create uniform blocks
			const cameraBlock = `
			layout(std140) uniform Camera { // size = 16
				float camera_aspect_ratio; // @ 0x00
				float camera_scale; // @ 0x04
				vec2 camera_pos; // @ 0x08
			};`;
			const backgroundBlock = `
			layout(std140) uniform Background { // size = 0x28
				vec4 border_color; // @ 0x00
				vec4 border_lrtb; // @ 0x10
				int dark_theme_enabled; // @ 0x20
				int grid_enabled; // @ 0x24
			};`;
			const cellBlock = `
			layout(std140) uniform Cell { // size = 0x5c
				float cell_radius; // @ 0x00
				float cell_radius_skin; // @ 0x04
				vec2 cell_xy; // @ 0x08
				vec4 cell_color; // @ 0x10
				vec4 cell_outline_subtle; // @ 0x20
				vec4 cell_outline_unsplittable; // @ 0x30
				vec4 cell_outline_active; // @ 0x40
				float cell_outline_active_thickness; // @ 0x50
				int cell_skin_enabled; // @ 0x54
				float cell_alpha; // @ 0x58
			};`;
			const cellGlowBlock = `
			layout(std140) uniform CellGlow { // size = 0x20
				float cell_radius; // @ 0x00
				float cell_alpha; // @ 0x04
				vec2 cell_xy; // @ 0x08
				vec4 cell_color; // @ 0x10
			};`;
			const textBlock = `
			layout(std140) uniform Text { // size = 0x44
				float cell_radius; // @ 0x00
				float text_alpha; // @ 0x04
				vec2 cell_xy; // @ 0x08
				float text_aspect_ratio; // @ 0x10
				float text_scale; // @ 0x14
				vec2 text_offset; // @ 0x18
				vec4 text_color1; // @ 0x20
				vec4 text_color2; // @ 0x30
				int text_silhouette_enabled; // @ 0x40
			};`;
			const tracerBlock = `
			layout(std140) uniform Tracer { // size = 0x10
				vec2 tracer_pos1; // @ 0x00
				vec2 tracer_pos2; // @ 0x04
			};`;


			// create programs and uniforms
			programs.bg = program(
				'bg',
				shader('bg.vShader', gl.VERTEX_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				layout(location = 0) in vec2 a_pos;
				${cameraBlock}
				${backgroundBlock}
				out vec2 v_world_pos;

				void main() {
					gl_Position = vec4(a_pos, 0, 1);

					v_world_pos = a_pos * vec2(camera_aspect_ratio, 1.0) / camera_scale;
					v_world_pos += camera_pos * vec2(1.0, -1.0);
				}
				`),
				shader('bg.fShader', gl.FRAGMENT_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				in vec2 v_world_pos;
				${cameraBlock}
				${backgroundBlock}
				uniform sampler2D grid_texture;
				out vec4 out_color;

				void main() {
					if (grid_enabled != 0) {
						out_color = texture(grid_texture, v_world_pos * 0.02);
						out_color.a *= 0.1;
						if (dark_theme_enabled == 0) {
							out_color.rgb = vec3(0, 0, 0);
						}
					}

					// force border to always be visible, otherwise it flickers
					float thickness = max(3.0 / (camera_scale * 540.0), 25.0);

					// make a larger inner rectangle and a normal inverted outer rectangle
					float inner_alpha = min(
						min((v_world_pos.x + thickness) - border_lrtb[0],
							border_lrtb[1] - (v_world_pos.x - thickness)),
						min((v_world_pos.y + thickness) - border_lrtb[2],
							border_lrtb[3] - (v_world_pos.y - thickness))
					);
					float outer_alpha = max(
						max(border_lrtb[0] - v_world_pos.x, v_world_pos.x - border_lrtb[1]),
						max(border_lrtb[2] - v_world_pos.y, v_world_pos.y - border_lrtb[3])
					);
					float alpha = clamp(min(inner_alpha, outer_alpha), 0.0, 1.0);

					out_color = out_color * (1.0 - alpha) + border_color * alpha;
				}
				`),
			);
			uniforms.bg = {
				camera: ubo(programs.bg, 'Camera'),
				background: ubo(programs.bg, 'Background'),
			};



			programs.cell = program(
				'cell',
				shader('cell.vShader', gl.VERTEX_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				layout(location = 0) in vec2 a_pos;
				${cameraBlock}
				${cellBlock}
				out vec2 v_pos;
				out vec2 v_uv;

				void main() {
					v_pos = a_pos;
					v_uv = a_pos * (cell_radius / cell_radius_skin) * 0.5 + 0.5;

					vec2 clip_pos = -camera_pos + cell_xy + v_pos * cell_radius;
					clip_pos *= camera_scale * vec2(1.0 / camera_aspect_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
				`),
				shader('cell.fShader', gl.FRAGMENT_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				in vec2 v_pos;
				in vec2 v_uv;
				${cameraBlock}
				${cellBlock}
				uniform sampler2D cell_skin;
				out vec4 out_color;

				void main() {
					float blur = 0.5 * cell_radius * (540.0 * camera_scale);
					float d = length(v_pos.xy);

					out_color = cell_color;

					if (cell_skin_enabled != 0) {
						// square clipping, outskirts should use the cell color
						if (0.0 <= min(v_uv.x, v_uv.y) && max(v_uv.x, v_uv.y) <= 1.0) {
							vec4 tc = texture(cell_skin, v_uv);
							out_color = out_color * (1.0 - tc.a) + tc;
						}
					}

					{
						// slightly darker outline around cells
						float subtle_thickness = max(cell_radius * 0.02, 10.0);
						float inner_radius = 1.0 - subtle_thickness / cell_radius;
						float a = clamp(blur * (d - inner_radius), 0.0, 1.0) * cell_outline_subtle.a;
						out_color.rgb = out_color.rgb * (1.0 - a) + cell_outline_subtle.rgb * a;
					}

					{
						// thick multibox outline, a % of the visible cell radius
						float inv_thickness = 1.0 - cell_outline_active_thickness;
						float a = clamp(blur * (d - inv_thickness), 0.0, 1.0) * cell_outline_active.a;
						out_color.rgb = out_color.rgb * (1.0 - a) + cell_outline_active.rgb * a;
					}

					{
						// unsplittable cell outline, 2x the subtle thickness
						// except at small sizes, so it doesn't look overly thick
						float unsplittable_thickness = max(cell_radius * 0.04, 10.0);
						float inner_radius = 1.0 - unsplittable_thickness / cell_radius;
						float a = clamp(blur * (d - inner_radius), 0.0, 1.0) * cell_outline_unsplittable.a;
						out_color.rgb = out_color.rgb * (1.0 - a) + cell_outline_unsplittable.rgb * a;
					}

					// final circle mask
					out_color.a *= clamp(-blur * (d - 1.0), 0.0, 1.0) * cell_alpha;
				}
				`),
			);
			uniforms.cell = {
				camera: ubo(programs.cell, 'Camera'),
				cell: ubo(programs.cell, 'Cell'),
			};



			programs.cellGlow = program(
				'cellGlow',
				shader('cellGlow.vShader', gl.VERTEX_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				layout(location = 0) in vec2 a_pos;
				${cameraBlock}
				${cellGlowBlock}
				out vec2 v_pos;

				void main() {
					v_pos = a_pos;

					// should probably make the 4.0 a setting
					vec2 clip_pos = -camera_pos + cell_xy + a_pos * (cell_radius * 4.0 + 50.0);
					clip_pos *= camera_scale * vec2(1.0 / camera_aspect_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
				`),
				shader('cellGlow.fShader', gl.FRAGMENT_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				in vec2 v_pos;
				${cameraBlock}
				${cellGlowBlock}
				out vec4 out_color;

				void main() {
					float d2 = v_pos.x * v_pos.x + v_pos.y * v_pos.y;
					// 20 radius (4 mass) => 0.1
					// 200 radius (400 mass) => 0.15
					// 2000 radius (40,000 mass) => 0.2
					float strength = log(5.0 * cell_radius) / log(10.0) * 0.05;
					out_color = vec4(cell_color.rgb, cell_color.a * cell_alpha * (1.0 - pow(d2, 0.25)) * strength);
				}
				`),
			);
			uniforms.cellGlow = {
				camera: ubo(programs.cellGlow, 'Camera'),
				cellGlow: ubo(programs.cellGlow, 'CellGlow'),
			};



			programs.text = program(
				'text',
				shader('text.vShader', gl.VERTEX_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				layout(location = 0) in vec2 a_pos;
				${cameraBlock}
				${textBlock}
				out vec2 v_pos;

				void main() {
					v_pos = a_pos;
					vec2 clip_space = v_pos * text_scale + text_offset;
					clip_space *= cell_radius * 0.45 * vec2(text_aspect_ratio, 1.0);
					clip_space += -camera_pos + cell_xy;
					clip_space *= camera_scale * vec2(1.0 / camera_aspect_ratio, -1.0);
					gl_Position = vec4(clip_space, 0, 1);
				}
				`),
				shader('text.fShader', gl.FRAGMENT_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				in vec2 v_pos;
				${cameraBlock}
				${textBlock}
				uniform sampler2D text_colored;
				uniform sampler2D text_silhouette;
				out vec4 out_color;

				void main() {
					vec2 uv = v_pos * 0.5 + 0.5;

					float c2_alpha = (uv.x + uv.y) / 2.0;
					vec4 color = text_color1 * (1.0 - c2_alpha) + text_color2 * c2_alpha;
					vec4 normal = texture(text_colored, uv);

					if (text_silhouette_enabled != 0) {
						vec4 silhouette = texture(text_silhouette, uv);

						// #fff - #000 => color (text)
						// #fff - #fff => #fff (respect emoji)
						// #888 - #888 => #888 (respect emoji)
						// #fff - #888 => #888 + color/2 (blur/antialias)
						out_color = silhouette + (normal - silhouette) * color;
					} else {
						out_color = normal * color;
					}

					out_color.a *= text_alpha;
				}
				`),
			);
			uniforms.text = {
				camera: ubo(programs.text, 'Camera'),
				text: ubo(programs.text, 'Text'),
				text_silhouette: gl.getUniformLocation(programs.text, 'text_silhouette')
			};

			programs.tracer = program(
				'tracer',
				shader('tracer.vShader', gl.VERTEX_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				layout(location = 0) in vec2 a_pos;
				${cameraBlock}
				${tracerBlock}
				out vec2 v_pos;

				void main() {
					v_pos = a_pos;
					float alpha = (a_pos.x + 1.0) * 0.5;
					float d = length(tracer_pos2 - tracer_pos1);
					float thickness = 0.002 / camera_scale;
					// black magic
					vec2 world_pos = tracer_pos1 + (tracer_pos2 - tracer_pos1)
						* mat2(alpha, a_pos.y / d * thickness, a_pos.y / d * -thickness, alpha);

					vec2 clip_pos = -camera_pos + world_pos;
					clip_pos *= camera_scale * vec2(1.0 / camera_aspect_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
				`),
				shader('tracer.fShader', gl.FRAGMENT_SHADER, `#version 300 es
				precision highp float;
				precision highp int;
				in vec2 v_pos;
				out vec4 out_color;

				void main() {
					out_color = vec4(0.5, 0.5, 0.5, 0.25);
				}
				`),
			);
			uniforms.tracer = {
				camera: ubo(programs.tracer, 'Camera'),
				tracer: ubo(programs.tracer, 'Tracer'),
			};

			// create and bind objects
			const square = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, square);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
				-1, -1,
				1, -1,
				-1, 1,
				1, 1,
			]), gl.STATIC_DRAW);

			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		}

		init();

		return { init, programs, uniforms };
	})();



	///////////////////////////////
	// Define Rendering Routines //
	///////////////////////////////
	const render = (() => {
		const render = {};
		const { gl } = ui.game;

		render.debug = false;

		// #1 : define small misc objects
		// no point in breaking this across multiple lines
		// eslint-disable-next-line max-len
		const gridSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IArs4c6QAAAKVJREFUaEPtkkEKwlAUxBzw/jeWL4J4gECkSrqftC/pzjnn9gfP3ofcf/mWbY8OuVLBilypxutbKlIRyUC/liQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNKyIJBZjK4LVScOKSGIxtiJYnTSsiCQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNPwU2TbpHV/DPgFxJfgvliP9RQAAAABJRU5ErkJggg==';



		// #2 : define helper functions
		const { resetTextureCache, textureFromCache } = (() => {
			/** @type {Map<string, WebGLTexture | null>} */
			const cache = new Map();
			render.textureCache = cache;

			return {
				resetTextureCache: () => cache.clear(),
				/**
				 * @param {string} src
				 */
				textureFromCache: src => {
					const cached = cache.get(src);
					if (cached !== undefined)
						return cached ?? undefined;

					cache.set(src, null);

					const image = new Image();
					image.crossOrigin = 'anonymous';
					image.addEventListener('load', () => {
						const texture = /** @type {WebGLTexture} */ (gl.createTexture());
						if (!texture) return;

						gl.bindTexture(gl.TEXTURE_2D, texture);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
						gl.generateMipmap(gl.TEXTURE_2D);
						cache.set(src, texture);
					});
					image.src = src;

					return undefined;
				},
			};
		})();
		render.resetTextureCache = resetTextureCache;

		const { massTextFromCache, resetTextCache, textFromCache } = (() => {
			/**
			 * @template {boolean} T
			 * @typedef {{
			 * 	aspectRatio: number,
			 * 	text: WebGLTexture | null | undefined,
			 *	silhouette: WebGLTexture | null | undefined,
			 * 	accessed: number
			 * }} CacheEntry
			 */
			/** @type {Map<string, CacheEntry<boolean>>} */
			const cache = new Map();
			render.textCache = cache;

			setInterval(() => {
				// remove text after not being used for 1 minute
				const now = performance.now();
				cache.forEach((entry, text) => {
					if (now - entry.accessed > 60_000) {
						// immediately delete text instead of waiting for GC
						if (entry.text !== undefined)
							gl.deleteTexture(entry.text);
						if (entry.silhouette !== undefined)
							gl.deleteTexture(entry.silhouette);
						cache.delete(text);
					}
				});
			}, 60_000);

			const canvas = document.createElement('canvas');
			const ctx = aux.require(
				canvas.getContext('2d', { willReadFrequently: true }),
				'Unable to get 2D context for text drawing. This is probably your browser being weird, maybe reload ' +
				'the page?',
			);

			const baseTextSize = 96;

			/**
			 * @param {string} text
			 * @param {boolean} silhouette
			 * @param {boolean} mass
			 * @returns {WebGLTexture | null}
			 */
			const texture = (text, silhouette, mass) => {
				const texture = gl.createTexture();
				if (!texture) return texture;

				const textSize = baseTextSize * (mass ? 0.5 * settings.massScaleFactor : settings.nameScaleFactor);
				const lineWidth = Math.ceil(textSize / 10);

				let font = '';
				if (mass ? settings.massBold : settings.nameBold)
					font = 'bold';
				font += ' ' + textSize + 'px Ubuntu';

				ctx.font = font;
				canvas.width = ctx.measureText(text).width + lineWidth * 2;
				canvas.height = textSize * 3;
				ctx.clearRect(0, 0, canvas.width, canvas.height);

				// setting canvas.width resets the canvas state
				ctx.font = font;
				ctx.lineJoin = 'round';
				ctx.lineWidth = lineWidth;
				ctx.fillStyle = silhouette ? '#000' : '#fff';
				ctx.strokeStyle = '#000';
				ctx.textBaseline = 'middle';

				// add a space, which is to prevent sigmod from detecting the name
				ctx.strokeText(text + ' ', lineWidth, textSize * 1.5);
				ctx.fillText(text + ' ', lineWidth, textSize * 1.5);

				const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
				gl.generateMipmap(gl.TEXTURE_2D);
				return texture;
			};

			let drawnMassBold = false;
			let drawnMassScaleFactor = -1;
			let massAspectRatio = 1; // assumption: all mass digits are the same aspect ratio - true in the Ubuntu font
			/** @type {(WebGLTexture | undefined)[]} */
			const massTextCache = [];

			/**
			 * @param {string} digit
			 * @returns {{ aspectRatio: number, texture: WebGLTexture | null }}
			 */
			const massTextFromCache = digit => {
				if (settings.massScaleFactor !== drawnMassScaleFactor || settings.massBold !== drawnMassBold) {
					while (massTextCache.pop());
					drawnMassScaleFactor = settings.massScaleFactor;
					drawnMassBold = settings.massBold;
				}

				let cached = massTextCache[digit];
				if (!cached) {
					cached = massTextCache[digit] = texture(digit, false, true);
					massAspectRatio = canvas.width / canvas.height;
				}

				return { aspectRatio: massAspectRatio, texture: cached };
			};

			const resetTextCache = () => {
				cache.clear();
				while (massTextCache.pop());
			};

			let drawnNamesBold = false;
			let drawnNamesScaleFactor = -1;
			/**
			 * @template {boolean} T
			 * @param {string} text
			 * @param {T} silhouette
			 * @returns {CacheEntry<T>}
			 */
			const textFromCache = (text, silhouette) => {
				if (drawnNamesScaleFactor !== settings.nameScaleFactor || drawnNamesBold !== settings.nameBold) {
					cache.clear();
					drawnNamesScaleFactor = settings.nameScaleFactor;
					drawnNamesBold = settings.nameBold;
				}

				let entry = cache.get(text);
				if (!entry) {
					const shortened = aux.trim(text);
					/** @type {CacheEntry<T>} */
					const entry2 = entry = {
						text: undefined,
						aspectRatio: 1,
						silhouette: undefined,
						accessed: performance.now(),
					};
					cache.set(text, entry);
					setTimeout(() => {
						entry2.text = texture(shortened, false, false);
						entry2.aspectRatio = canvas.width / canvas.height; // mind the execution order
						if (silhouette)
							entry2.silhouette = texture(shortened, true, false);
					});
				} else {
					entry.accessed = performance.now();
				}

				if (silhouette && entry.silhouette === undefined) {
					setTimeout(() => {
						entry.silhouette = texture(aux.trim(text), true, false);
					});
				}

				return entry;
			};

			// reload text once Ubuntu has loaded, prevents some serif fonts from being locked in
			document.fonts.ready.then(() => resetTextCache());

			return { massTextFromCache, resetTextCache, textFromCache };
		})();
		render.resetTextCache = resetTextCache;



		// #3 : define the render function
		let fps = 0;
		let lastFrame = performance.now();
		function renderGame() {
			const now = performance.now();
			const dt = Math.max(now - lastFrame, 0.1) / 1000; // there's a chance (now - lastFrame) can be 0
			fps += (1 / dt - fps) / 10;
			lastFrame = now;

			if (gl.isContextLost()) {
				requestAnimationFrame(renderGame);
				return;
			}

			// when tabbing in, draw *as fast as possible* to prevent flickering effects
			// i'd imagine people using sigmally fixes won't have their fps naturally go below 20 anyway
			const fastDraw = dt >= 0.05;

			// get settings
			/** @type {string} */
			const virusSrc = aux.sigmodSettings?.virusImage ?? '/assets/images/viruses/2.png';

			const darkTheme = aux.setting('input#darkTheme', true);
			const showBorder = aux.setting('input#showBorder', true);
			const showGrid = aux.setting('input#showGrid', true);
			const showMass = aux.setting('input#showMass', false);
			const showMinimap = aux.setting('input#showMinimap', true);
			const showNames = aux.setting('input#showNames', true);
			const showSkins = aux.setting('input#showSkins', true);
			const jellyPhysics = aux.setting('input#jellyPhysics', false);

			/** @type {HTMLInputElement | null} */
			const nickElement = document.querySelector('input#nick');
			const nick = nickElement?.value ?? '?';

			// note: most routines are named, for benchmarking purposes
			(function updateCells() {
				input.move();
				world.update();
				sync.frame();
			})();

			(function setGlobalUniforms() {
				const aspectRatio = ui.game.canvas.width / ui.game.canvas.height;
				const cameraPosX = world.camera.x;
				const cameraPosY = world.camera.y;
				const cameraScale = world.camera.scale / 540; // (height of 1920x1080 / 2 = 540)

				const cameraData = new Float32Array([
					aspectRatio, cameraScale, cameraPosX, cameraPosY,
				]);

				[uniforms.bg.camera, uniforms.cell.camera, uniforms.cellGlow.camera,
					uniforms.text.camera, uniforms.tracer.camera].forEach(ubo => {
						gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cameraData);
					});

				// textures are usually initialized to TEXTURE0, but we need TEXTURE1
				gl.useProgram(programs.text);
				gl.uniform1i(uniforms.text.text_silhouette, 1);
			})();

			(function background() {
				if (aux.sigmodSettings?.mapColor) {
					gl.clearColor(...aux.sigmodSettings.mapColor);
				} else if (darkTheme) {
					gl.clearColor(0x11 / 255, 0x11 / 255, 0x11 / 255, 1); // #111
				} else {
					gl.clearColor(0xf2 / 255, 0xfb / 255, 0xff / 255, 1); // #f2fbff
				}
				gl.clear(gl.COLOR_BUFFER_BIT);

				const gridTexture = textureFromCache(gridSrc);
				if (!gridTexture) return;
				gl.bindTexture(gl.TEXTURE_2D, gridTexture);

				gl.useProgram(programs.bg);

				const dat = new DataView(new ArrayBuffer(0x28));

				if (showBorder && world.border) {
					// border_color = #00ff
					dat.setFloat32(0x00, 0, true);
					dat.setFloat32(0x04, 0, true);
					dat.setFloat32(0x08, 1, true);
					dat.setFloat32(0x0c, 1, true);

					// border_lrtb
					dat.setFloat32(0x10, world.border.l, true);
					dat.setFloat32(0x14, world.border.r, true);
					dat.setFloat32(0x18, world.border.t, true);
					dat.setFloat32(0x1c, world.border.b, true);
				} else {
					// border_color = #0000
					dat.setFloat32(0x00, 0, true);
					dat.setFloat32(0x04, 0, true);
					dat.setFloat32(0x08, 0, true);
					dat.setFloat32(0x0c, 0, true);

					// border_lrtb
					dat.setFloat32(0x10, 0, true);
					dat.setFloat32(0x14, 0, true);
					dat.setFloat32(0x18, 0, true);
					dat.setFloat32(0x1c, 0, true);
				}

				dat.setUint32(0x20, Number(darkTheme), true); // dark_theme_enabled
				dat.setUint32(0x24, Number(showGrid), true); // grid_enabled

				gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.bg.background);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, dat.buffer);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			})();

			(function cells() {
				const map = (settings.mergeViewArea && sync.merge) ? sync.merge : world;

				// for white cell outlines
				let nextCellIdx = world.mine.length;
				const canSplit = world.mine.map(id => {
					const cell = map.cells.get(id);
					if (!cell) {
						--nextCellIdx;
						return false;
					}

					if (cell.nr < 128)
						return false;

					return nextCellIdx++ < 16;
				});

				const { cellColor, foodColor, outlineColor, skinReplacement } = aux.sigmodSettings ?? {};

				/**
				 * @param {Cell} cell
				 * @returns {number}
				 */
				const calcAlpha = cell => {
					let alpha = (now - cell.born) / 100;
					if (cell.deadAt !== undefined) {
						const alpha2 = 1 - (now - cell.deadAt) / 100;
						if (alpha2 < alpha) alpha = alpha2;
					}
					alpha = alpha > 1 ? 1 : alpha < 0 ? 0 : alpha;
					return alpha;
				};

				const cellBuf = new ArrayBuffer(0x5c);
				const dat = new DataView(cellBuf);
				const textBuf = new ArrayBuffer(0x44);
				const datText = new DataView(textBuf);

				/**
				 * @param {Cell} cell
				 */
				function draw(cell) {
					// #1 : draw cell
					gl.useProgram(programs.cell);

					const alpha = calcAlpha(cell);
					dat.setFloat32(0x58, alpha * settings.cellOpacity, true); // cell_alpha

					const { x, y, r, jx, jy, jr } = world.xyr(cell, map, now);
					// without jelly physics, the radius of cells is adjusted such that its subtle outline doesn't go
					// past its original radius.
					// jelly physics does not do this, so colliding cells need to look kinda 'joined' together,
					// so we multiply the radius by 1.01 (approximately the size increase from the stroke thickness)
					if (jellyPhysics) {
						dat.setFloat32(0x08, jx, true); // cell_xy.x
						dat.setFloat32(0x0c, jy, true); // cell_xy.y
						dat.setFloat32(0x00, jr * 1.01, true); // cell_radius
						dat.setFloat32(0x04, (settings.jellySkinLag ? r : jr) * 1.01, true); // cell_radius_skin
					} else {
						dat.setFloat32(0x08, x, true); // cell_xy.x
						dat.setFloat32(0x0c, y, true); // cell_xy.y
						dat.setFloat32(0x00, r, true); // cell_radius
						dat.setFloat32(0x04, r, true); // cell_radius_skin
					}

					dat.setFloat32(0x2c, 0, true); // cell_outline_subtle_color.a
					dat.setFloat32(0x3c, 0, true); // cell_outline_unsplittable_color.a
					dat.setFloat32(0x4c, 0, true); // cell_outline_active_color.a
					dat.setFloat32(0x50, settings.outlineMulti, true); // cell_outline_active_thickness
					dat.setUint32(0x54, 0, true); // cell_skin_enabled

					if (cell.jagged) {
						const virusTexture = textureFromCache(virusSrc);
						if (!virusTexture)
							return;

						// cell_color = transparent (must set rgb too!)
						dat.setFloat32(0x10, 0, true);
						dat.setFloat32(0x14, 0, true);
						dat.setFloat32(0x18, 0, true);
						dat.setFloat32(0x1c, 0, true);
						dat.setUint32(0x54, 1, true); // cell_skin_enabled
						gl.bindTexture(gl.TEXTURE_2D, virusTexture);

						if (render.debug) console.log('cell is a virus');
						gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.cell.cell);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellBuf);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						return;
					}

					// TODO: redundant copy+paste
					if (cell.nr <= 20) {
						// cell_color
						if (foodColor) {
							dat.setFloat32(0x10, foodColor[0], true);
							dat.setFloat32(0x14, foodColor[1], true);
							dat.setFloat32(0x18, foodColor[2], true);
							dat.setFloat32(0x1c, foodColor[3], true);
						} else {
							dat.setFloat32(0x10, cell.Rgb, true);
							dat.setFloat32(0x14, cell.rGb, true);
							dat.setFloat32(0x18, cell.rgB, true);
							dat.setFloat32(0x1c, 1, true);
						}
					} else {
						// cell_color
						if (cellColor) {
							dat.setFloat32(0x10, cellColor[0], true);
							dat.setFloat32(0x14, cellColor[1], true);
							dat.setFloat32(0x18, cellColor[2], true);
							dat.setFloat32(0x1c, cellColor[3], true);
						} else {
							dat.setFloat32(0x10, cell.Rgb, true);
							dat.setFloat32(0x14, cell.rGb, true);
							dat.setFloat32(0x18, cell.rgB, true);
							dat.setFloat32(0x1c, 1, true);
						}
					}

					if (cell.nr > 20) {
						if (settings.cellOutlines) {
							// cell_outline_subtle_color
							if (outlineColor) {
								dat.setFloat32(0x20, outlineColor[0], true);
								dat.setFloat32(0x24, outlineColor[1], true);
								dat.setFloat32(0x28, outlineColor[2], true);
								dat.setFloat32(0x2c, outlineColor[3], true);
							} else {
								dat.setFloat32(0x20, 0, true);
								dat.setFloat32(0x24, 0, true);
								dat.setFloat32(0x28, 0, true);
								dat.setFloat32(0x2c, 0.1, true);
							}
						}

						const myIndex = world.mine.indexOf(cell.id);
						if (myIndex !== -1) {
							// cell_outline_active_color
							if (world.camera.merged) {
								dat.setFloat32(0x40, settings.outlineMultiColor[0], true);
								dat.setFloat32(0x44, settings.outlineMultiColor[1], true);
								dat.setFloat32(0x48, settings.outlineMultiColor[2], true);
								dat.setFloat32(0x4c, settings.outlineMultiColor[3], true);
							}	

							if (!canSplit[myIndex] && settings.unsplittableOpacity > 0) {
								// cell_outline_unsplittable_color
								if (darkTheme) {
									dat.setFloat32(0x30, 1, true);
									dat.setFloat32(0x34, 1, true);
									dat.setFloat32(0x38, 1, true);
									dat.setFloat32(0x3c, settings.unsplittableOpacity, true);
								} else {
									dat.setFloat32(0x30, 0, true);
									dat.setFloat32(0x34, 0, true);
									dat.setFloat32(0x38, 0, true);
									dat.setFloat32(0x3c, settings.unsplittableOpacity, true);
								}
							}
						}

						let skin = '';
						for (const [_, data] of sync.others) {
							if (data.owned.has(cell.id)) {
								// cell_outline_active_color
								dat.setFloat32(0x40, settings.outlineMultiInactiveColor[0], true);
								dat.setFloat32(0x44, settings.outlineMultiInactiveColor[1], true);
								dat.setFloat32(0x48, settings.outlineMultiInactiveColor[2], true);
								dat.setFloat32(0x4c, settings.outlineMultiInactiveColor[3], true);
								if (settings.syncSkin)
									skin = data.skin;
								break;
							}
						}

						if (settings.selfSkin && (world.mine.includes(cell.id) || world.mineDead.has(cell.id))) {
							skin = settings.selfSkin;
						} else {
							if (!skin && showSkins && cell.skin) {
								if (skinReplacement && cell.skin.includes(skinReplacement.original + '.png'))
									skin = skinReplacement.replacement ?? skinReplacement.replaceImg ?? '';
								else
									skin = cell.skin;
							}
						}

						if (skin) {
							const texture = textureFromCache(skin);
							if (texture) {
								// cell_skin_enabled
								dat.setUint32(0x54, 1, true);
								gl.bindTexture(gl.TEXTURE_2D, texture);
							}
						}
					}

					gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.cell.cell);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellBuf);
					// for whatever reason, a uniform buffer cannot be used twice in a row without being rebound
					// this is quite possibly the stupidest thing i've ever seen as i never had to do this before
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

					// #2 : draw text
					if (cell.nr <= 20) return; // quick return if a pellet
					const name = cell.name || 'An unnamed cell';
					const showThisName = showNames && cell.nr > 75;
					const showThisMass = showMass && cell.nr > 75;
					const clan = settings.clans ? (aux.clans.get(cell.clan) ?? cell.clan) : '';
					if (!showThisName && !showThisMass && !clan) return;

					gl.useProgram(programs.text);

					// text_alpha
					datText.setFloat32(0x04, alpha, true);
					if (jellyPhysics) {
						// cell_xy
						datText.setFloat32(0x08, jx, true);
						datText.setFloat32(0x0c, jy, true);
					} else {
						datText.setFloat32(0x08, x, true);
						datText.setFloat32(0x0c, y, true);
					}
					// cell_radius
					datText.setFloat32(0x00, r, true) // jelly physics never affects the text *size*

					let useSilhouette = false;
					if (cell.sub) {
						// text_color1 = #eb9500
						datText.setFloat32(0x20, 0xeb / 255, true);
						datText.setFloat32(0x24, 0x95 / 255, true);
						datText.setFloat32(0x28, 0x00 / 255, true);
						datText.setFloat32(0x2c, 1, true);
						
						// text_color2 = #e4b110
						datText.setFloat32(0x30, 0xe4 / 255, true);
						datText.setFloat32(0x34, 0xb1 / 255, true);
						datText.setFloat32(0x38, 0x10 / 255, true);
						datText.setFloat32(0x3c, 1, true);
						useSilhouette = true;
					} else {
						// text_color1 = #ffffff
						datText.setFloat32(0x20, 1, true);
						datText.setFloat32(0x24, 1, true);
						datText.setFloat32(0x28, 1, true);
						datText.setFloat32(0x2c, 1, true);

						// text_color2 = #ffffff
						datText.setFloat32(0x30, 1, true);
						datText.setFloat32(0x34, 1, true);
						datText.setFloat32(0x38, 1, true);
						datText.setFloat32(0x3c, 1, true);
					}

					if (name === nick) {
						if (aux.sigmodSettings?.nameColor1) {
							// text_color1 = aux.sigmodSettings.nameColor1
							datText.setFloat32(0x20, aux.sigmodSettings.nameColor1[0], true);
							datText.setFloat32(0x24, aux.sigmodSettings.nameColor1[1], true);
							datText.setFloat32(0x28, aux.sigmodSettings.nameColor1[2], true);
							datText.setFloat32(0x2c, aux.sigmodSettings.nameColor1[3], true);
							useSilhouette = true;
						}

						if (aux.sigmodSettings?.nameColor2) {
							// text_color2 = aux.sigmodSettings.nameColor2
							datText.setFloat32(0x30, aux.sigmodSettings.nameColor2[0], true);
							datText.setFloat32(0x34, aux.sigmodSettings.nameColor2[1], true);
							datText.setFloat32(0x38, aux.sigmodSettings.nameColor2[2], true);
							datText.setFloat32(0x3c, aux.sigmodSettings.nameColor2[3], true);
							useSilhouette = true;
						}
					}

					if (clan) {
						const { aspectRatio, text, silhouette } = textFromCache(clan, useSilhouette);
						if (text) {
							// text_aspect_ratio
							datText.setFloat32(0x10, aspectRatio, true);
							// text_silhouette_enabled
							datText.setUint32(0x40, silhouette ? 1 : 0, true);
							// text_scale
							datText.setFloat32(0x14, showThisName ? 0.5 : 1, true);
							// text_offset
							datText.setFloat32(0x18, 0, true);
							datText.setFloat32(0x1c, showThisName ? -settings.nameScaleFactor / 3 - 1 / 6 : 0, true);

							gl.bindTexture(gl.TEXTURE_2D, text);
							if (silhouette) {
								gl.activeTexture(gl.TEXTURE1);
								gl.bindTexture(gl.TEXTURE_2D, silhouette);
								gl.activeTexture(gl.TEXTURE0);
							}

							gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.text.text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textBuf);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}

					if (showThisName) {
						const { aspectRatio, text, silhouette } = textFromCache(name, useSilhouette);
						if (text) {
							// text_aspect_ratio
							datText.setFloat32(0x10, aspectRatio, true);
							// text_silhouette_enabled
							datText.setUint32(0x40, silhouette ? 1 : 0, true);
							// text_offset
							datText.setFloat32(0x18, 0, true);
							datText.setFloat32(0x1c, 0, true);
							// text_scale
							datText.setFloat32(0x14, settings.nameScaleFactor, true);

							gl.bindTexture(gl.TEXTURE_2D, text);
							if (silhouette) {
								gl.activeTexture(gl.TEXTURE1);
								gl.bindTexture(gl.TEXTURE_2D, silhouette);
								gl.activeTexture(gl.TEXTURE0);
							}

							gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.text.text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textBuf);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}

					if (showThisMass) {
						// text_alpha
						datText.setFloat32(0x04, alpha * settings.massOpacity, true);
						// text_silhouette_enabled
						datText.setUint32(0x40, 0, true);
						// text_scale
						datText.setFloat32(0x14, 0.5 * settings.massScaleFactor, true);

						if (showThisName) {
							// text_offset.y
							datText.setFloat32(0x1c, settings.nameScaleFactor / 3 + 0.5 * settings.massScaleFactor / 3, true);
						} else if (clan) {
							// text_offset.y
							datText.setFloat32(0x1c, 1/3 + 0.5 * settings.massScaleFactor/3, true);
						} else {
							// text_offset.y
							datText.setFloat32(0x1c, 0, true);
						}

						// draw each digit separately, as Ubuntu makes them all the same width.
						// significantly reduces the size of the text cache
						const mass = Math.floor(cell.nr * cell.nr / 100).toString();
						for (let i = 0; i < mass.length; ++i) {
							const { aspectRatio, texture } = massTextFromCache(mass[i]);
							// text_aspect_ratio
							datText.setFloat32(0x10, aspectRatio, true);
							// text_offset.x
							datText.setFloat32(0x18, (i - (mass.length - 1)/2) * 0.75 * settings.massScaleFactor, true);

							gl.bindTexture(gl.TEXTURE_2D, texture);

							gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms.text.text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textBuf);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}
				}

				wasm['tab.sort'](0, now);
				for (const cell of wasm.TEMP.cells(0, true)) {
					draw(cell);
				}

				for (const cell of wasm.TEMP.cells(0, false)) {
					draw(cell);
				}

				//if (!aux.sigmodSettings?.hidePellets)
				//	for (const cell of map.pellets.values())
				//		draw(cell);

				/** @type {[Cell, number][]} */
				//const sorted = [];
				//for (const cell of map.cells.values()) {
				//	const computedR = cell.or + (cell.nr - cell.or) * (now - cell.updated) / settings.drawDelay;
				//	sorted.push([cell, computedR]);
				//}
				// sort by smallest to biggest
				//sorted.sort(([_a, ar], [_b, br]) => ar - br);
				//for (const [cell] of sorted)
				//	draw(cell);

				// redraw if using rtx
				if (settings.rtx) {
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive blending
					gl.useProgram(programs.cellGlow);

					/** @param {Cell} cell */
					const drawRtx = cell => {
						if (cell.jagged) return;

						gl.uniform1f(uniforms.cellGlow.u_alpha, calcAlpha(cell) * settings.cellOpacity);

						if (cell.nr <= 20 && foodColor)
							gl.uniform4f(uniforms.cellGlow.u_color, ...foodColor);
						else if (cellColor)
							gl.uniform4f(uniforms.cellGlow.u_color, ...cellColor);
						else
							gl.uniform4f(uniforms.cellGlow.u_color, cell.Rgb, cell.rGb, cell.rgB, 1);

						const { x, y, r, jx, jy, jr } = world.xyr(cell, map, now);
						if (jellyPhysics) {
							gl.uniform2f(uniforms.cellGlow.u_pos, jx, jy);
							gl.uniform1f(uniforms.cellGlow.u_radius, jr);
						} else {
							gl.uniform2f(uniforms.cellGlow.u_pos, x, y);
							gl.uniform1f(uniforms.cellGlow.u_radius, r);
						}

						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					};

					if (!aux.sigmodSettings?.hidePellets)
						for (const cell of map.pellets.values())
							drawRtx(cell);

					for (const [cell] of sorted)
						drawRtx(cell);

					gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				}

				// draw tracers
				if (settings.tracer) {
					gl.useProgram(programs.tracer);

					const [x, y] = input.mouse();
					gl.uniform2f(uniforms.tracer.u_pos2, x, y);

					world.mine.forEach(id => {
						const cell = map.cells.get(id);
						if (!cell) return;

						let { x, y, jx, jy } = world.xyr(cell, map, now);
						if (jellyPhysics)
							gl.uniform2f(uniforms.tracer.u_pos1, jx, jy);
						else
							gl.uniform2f(uniforms.tracer.u_pos1, x, y);

						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					});
				}
			})();

			(function updateStats() {
				if (fastDraw) return;
				ui.stats.matchTheme(); // not sure how to listen to when the checkbox changes when the game loads
				if (showNames && world.leaderboard.length > 0)
					ui.leaderboard.container.style.display = '';
				else
					ui.leaderboard.container.style.display = 'none';

				let score = 0;
				world.mine.forEach(id => {
					const cell = world.cells.get(id);
					if (!cell || cell.deadAt !== undefined) return;

					score += cell.nr * cell.nr / 100;
				});

				if (typeof aux.userData?.boost === 'number' && aux.userData.boost > Date.now())
					score *= 2;

				if (score > 0)
					ui.stats.score.textContent = 'Score: ' + Math.floor(score);
				else
					ui.stats.score.textContent = '';

				let measures = `${Math.floor(fps)} FPS`;
				if (net.latency !== undefined) {
					if (net.latency === -1)
						measures += ' ????ms ping';
					else
						measures += ` ${Math.floor(net.latency)}ms ping`;
				}

				ui.stats.measures.textContent = measures;

				if (score > world.stats.highestScore) {
					world.stats.highestScore = score;
				}
			})();

			(function minimap() {
				if (fastDraw) return;
				if (!showMinimap) {
					ui.minimap.canvas.style.display = 'none';
					return;
				} else {
					ui.minimap.canvas.style.display = '';
				}

				const { border } = world;
				if (!border) return;

				// text needs to be small and sharp, i don't trust webgl with that, so we use a 2d context
				const { canvas, ctx } = ui.minimap;
				canvas.width = canvas.height = 200 * devicePixelRatio;

				// sigmod overlay resizes itself differently, so we correct it whenever we need to
				/** @type {HTMLCanvasElement | null} */
				const sigmodMinimap = document.querySelector('canvas.minimap');
				if (sigmodMinimap) {
					// we need to check before updating the canvas, otherwise we will clear it
					if (sigmodMinimap.style.width !== '200px' || sigmodMinimap.style.height !== '200px')
						sigmodMinimap.style.width = sigmodMinimap.style.height = '200px';

					if (sigmodMinimap.width !== canvas.width || sigmodMinimap.height !== canvas.height)
						sigmodMinimap.width = sigmodMinimap.height = 200 * devicePixelRatio;
				}

				ctx.clearRect(0, 0, canvas.width, canvas.height);

				const gameWidth = (border.r - border.l);
				const gameHeight = (border.b - border.t);

				// highlight current section
				ctx.fillStyle = '#ff0';
				ctx.globalAlpha = 0.3;

				const sectionX = Math.floor((world.camera.x - border.l) / gameWidth * 5);
				const sectionY = Math.floor((world.camera.y - border.t) / gameHeight * 5);
				const sectorSize = canvas.width / 5;
				ctx.fillRect(sectionX * sectorSize, sectionY * sectorSize, sectorSize, sectorSize);

				// draw section names
				ctx.font = `${Math.floor(sectorSize / 3)}px Ubuntu`;
				ctx.fillStyle = darkTheme ? '#fff' : '#000';
				ctx.globalAlpha = 0.3;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				const cols = ['1', '2', '3', '4', '5'];
				const rows = ['A', 'B', 'C', 'D', 'E'];
				cols.forEach((col, y) => {
					rows.forEach((row, x) => {
						ctx.fillText(row + col, (x + 0.5) * sectorSize, (y + 0.5) * sectorSize);
					});
				});

				ctx.globalAlpha = 1;



				// draw cells
				/** @param {Cell} cell */
				const drawCell = function drawCell(cell) {
					const x = (cell.nx - border.l) / gameWidth * canvas.width;
					const y = (cell.ny - border.t) / gameHeight * canvas.height;
					const r = Math.max(cell.nr / gameWidth * canvas.width, 2);

					ctx.fillStyle = aux.rgba2hex(cell.Rgb, cell.rGb, cell.rgB, 1);
					ctx.beginPath();
					ctx.moveTo(x + r, y);
					ctx.arc(x, y, r, 0, 2 * Math.PI);
					ctx.fill();
				};

				/**
				 * @param {number} x
				 * @param {number} y
				 * @param {string} name
				 */
				const drawName = function drawName(x, y, name) {
					x = (x - border.l) / gameWidth * canvas.width;
					y = (y - border.t) / gameHeight * canvas.height;

					ctx.fillStyle = '#fff';
					// add a space to prevent sigmod from detecting names
					ctx.fillText(name + ' ', x, y - 7 * devicePixelRatio - sectorSize / 6);
				};

				// draw clanmates first, below yourself
				// we sort clanmates by color AND name, to ensure clanmates stay separate
				/** @type {Map<string, { name: string, n: number, x: number, y: number }>} */
				const avgPos = new Map();
				world.clanmates.forEach(cell => {
					if (world.mine.includes(cell.id)) return;
					drawCell(cell);

					const name = cell.name || 'An unnamed cell';
					const id = ((name + cell.Rgb) + cell.rGb) + cell.rgB;
					const entry = avgPos.get(id);
					if (entry) {
						++entry.n;
						entry.x += cell.nx;
						entry.y += cell.ny;
					} else {
						avgPos.set(id, { name, n: 1, x: cell.nx, y: cell.ny });
					}
				});

				avgPos.forEach(entry => {
					drawName(entry.x / entry.n, entry.y / entry.n, entry.name);
				});

				// draw my cells above everyone else
				let myName = '';
				let ownN = 0;
				let ownX = 0;
				let ownY = 0;
				world.mine.forEach(id => {
					const cell = world.cells.get(id);
					if (!cell) return;

					drawCell(cell);
					myName = cell.name || 'An unnamed cell';
					++ownN;
					ownX += cell.nx;
					ownY += cell.ny;
				});

				if (ownN <= 0) {
					// if no cells were drawn, draw our spectate pos instead
					const x = (world.camera.x - border.l) / gameWidth * canvas.width;
					const y = (world.camera.y - border.t) / gameHeight * canvas.height;

					ctx.fillStyle = '#faa';
					ctx.beginPath();
					ctx.moveTo(x + 5, y);
					ctx.arc(x, y, 5 * devicePixelRatio, 0, 2 * Math.PI);
					ctx.fill();
				} else {
					ownX /= ownN;
					ownY /= ownN;
					// draw name above player's cells
					drawName(ownX, ownY, myName);

					// send a hint to sigmod
					ctx.globalAlpha = 0;
					ctx.fillText(`X: ${ownX}, Y: ${ownY}`, 0, -1000);
				}
			})();

			ui.chat.matchTheme();

			render.debug = false;

			requestAnimationFrame(renderGame);
		}

		renderGame();
		return render;
	})();



	// @ts-expect-error for debugging purposes. dm me on discord @8y8x to work out stability if you need something
	window.sigfix = {
		destructor, aux, ui, settings, sync, world, net, gl: { init: initWebGL, programs, uniforms }, render, wasm,
	};
})();
