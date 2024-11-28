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

				wasm['settings.sm.update'](0, 0, 0, -1);
			}

			wasm['settings.update'](
				aux.setting('input#jellyPhysics', false)
			);

			ui.stats.matchTheme();
			ui.chat.matchTheme();
		}, 200);

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
		setInterval(settings, 200);
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
		setInterval(() => void (onkeydown = onkeyup = null), 500);

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

			const update = (score, fps, ping) => {
				ui.leaderboard.container.style.display = (aux.setting('input#showNames', true) && world.leaderboard.length > 0) ? '' : 'none';

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
			};

			/** @param {object} statData */
			function updateMisc(statData) {
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

			return { container, score, measures, misc, update, updateMisc, matchTheme };
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

			// specify willReadFrequently: false due to the 2 getImageData calls on startup
			const ctx = aux.require(
				canvas.getContext('2d', { willReadFrequently: false }),
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
			+ '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X3JlZgIMY2FtZXJhLmdldF94AwxjYW1lcmEuZ2V0X3kEEGNhbWVyYS5nZXRfc2NhbGUFDWNhbWVyYS50YXJnZXQGDWNhbWVyYS51cGRhdGUHDWNlbGwuYWxsb2NhdGUICmNlbGwuYnlfaWQJC2NlbGwuY3JlYXRlCg9jZWxsLmRlYWxsb2NhdGULE2NlbGwuZmlyc3RfY2VsbF9wdHIMFWNlbGwuZmlyc3RfcGVsbGV0X3B0cg0OY2VsbC5udW1fY2VsbHMOEGNlbGwubnVtX3BlbGxldHMPEWlucHV0Lnpvb21fdXBkYXRlEAxtaXNjLm1lbWNweTgRD21pc2MudW50aWxfemVybxIPcmVuZGVyLmNlbGxfdWJvExNyZW5kZXIuY2VsbF91Ym9fcHRyFBZyZW5kZXIudGV4dF91Ym9fYmFzaWNzFRRyZW5kZXIudGV4dF91Ym9fbmFtZRYUcmVuZGVyLnRleHRfdWJvX21hc3MXE3JlbmRlci50ZXh0X3Vib19wdHIYF3JlbmRlci51cGRhdGVfdmlydXNfcmVmGQ9zZXR0aW5ncy51cGRhdGUaEnNldHRpbmdzLnNmLnVwZGF0ZRsSc2V0dGluZ3Muc20udXBkYXRlHAx0YWIuYWxsb2NhdGUdCXRhYi5jbGVhch4LdGFiLmNsZWFudXAfDnRhYi5ncm93X3NwYWNlIA10YWIub3duZWQuYWRkIQ10YWIub3duZWQubnVtIhB0YWIub3duZWQucmVtb3ZlIwl0YWIuc2NvcmUkCHRhYi5zb3J0JRB3cy5oYW5kbGVfdXBkYXRlAtoJJgACAARmcm9tAQJ0bwECAARmcm9tAQJ0bwIAAwAEAAUEAAJ0eAECdHkCBnRzY2FsZQMFZm9yY2UGDwADdGFiAQNub3cCCGNlbGxfcHRyAwpvd25lZF9iYXNlBAZsZW5ndGgFAWkGBndlaWdodAcFc3VtX3gIBXN1bV95CQx0b3RhbF93ZWlnaHQKB3RvdGFsX3ILB3pvb21vdXQMBWFscGhhDQNvbGQOA25ldwcFAAN0YWIBCWlzX3BlbGxldAIEYmFzZQMKbGVuZ3RoX3B0cgQGbGVuZ3RoCAUAA3RhYgECaWQCCWlzX3BlbGxldAMHY2VsbF9pZAQIY2VsbF9wdHIJDgADdGFiAQNub3cCAmlkAwF4BAF5BQFyBgZqYWdnZWQHA3N1YggIY2xhbl9wdHIJA3JnYgoIc2tpbl9wdHILCG5hbWVfcHRyDAhjZWxsX3B0cg0JaXNfcGVsbGV0CgcAA3RhYgEIY2VsbF9wdHICCWlzX3BlbGxldAMEYmFzZQQNbGFzdF9jZWxsX3B0cgUKbGVuZ3RoX3B0cgYKbmV3X2xlbmd0aAsBAAN0YWIMAQADdGFiDQEAA3RhYg4BAAN0YWIPAQAEem9vbRAEAARmcm9tAQJ0bwIEc2l6ZQMIZnJvbV9lbmQRAQABbxIOAAN0YWIBCGNlbGxfcHRyAgNub3cDCWlzX3BlbGxldAQFYWxwaGEFA29sZAYDbmV3Bwd1Ym9fcHRyCAl4eXJfYWxwaGEJCWNlbGxfcHRyMgoHZGVhZF90bwsCbngMAm55DQhza2luX3JlZhMAFAUACGNlbGxfcHRyAQNub3cCBWFscGhhAwNvbGQEA25ldxUDAAhjZWxsX3B0cgEDbm93AgVhbHBoYRYDAAhjZWxsX3B0cgEGZGlnaXRzAgRtYXNzFwAYAQADcmVmGQEADWplbGx5X3BoeXNpY3MaAgAKZHJhd19kZWxheQEMbWFzc19vcGFjaXR5GwQADGNlbGxfY29sb3IucgEMY2VsbF9jb2xvci5nAgxjZWxsX2NvbG9yLmIDDGNlbGxfY29sb3IuYRwAHQIAA3RhYgEIY2VsbF9wdHIeAwADdGFiAQNub3cCCGNlbGxfcHRyHwQABXBhZ2VzAQFpAglmcm9tX2Jhc2UDB3RvX2Jhc2UgBAADdGFiAQJpZAIGbGVuZ3RoAwltaXNjX2Jhc2UhAQADdGFiIgYAA3RhYgECaWQCBmxlbmd0aAMJbWlzY19iYXNlBAFpBQNwdHIjBgADdGFiAQhjZWxsX3B0cgIBaQMGbGVuZ3RoBApvd25lZF9iYXNlBQVzY29yZSQNAAN0YWIBA25vdwIFYWxwaGEDCWNlbGxfYmFzZQQGbGVuZ3RoBQFpBgFqBwhpX3JhZGl1cwgIal9yYWRpdXMJA29sZAoDbmV3CwpjZWxsX3B0cl9pDApjZWxsX3B0cl9qJRYAA3RhYgEDbm93AgVjb3VudAMFZmxhZ3MEAWkFA2lkMQYDaWQyBwFvCAF4CQF5CgFyCwZqYWdnZWQMA3N1Yg0IY2VsbF9wdHIOCG5hbWVfcmVmDwhza2luX3JlZhAIY2xhbl9yZWYRA3JnYhIJaXNfcGVsbGV0EwVhbHBoYRQJaW52X2FscGhhFQpkcmF3X2RlbGF5B4sFIQAIY2FtZXJhLngBCGNhbWVyYS55AgxjYW1lcmEuc2NhbGUDCWNhbWVyYS50eAQJY2FtZXJhLnR5BQ1jYW1lcmEudHNjYWxlBg5jYW1lcmEudXBkYXRlZAcKaW5wdXQuem9vbQgacmVuZGVyLmNhbWVyYS51Ym9fcHRyX3JlYWwJGHJlbmRlci5jZWxsX3Vib19wdHJfcmVhbAoYcmVuZGVyLnRleHRfdWJvX3B0cl9yZWFsCxByZW5kZXIudmlydXNfcmVmDBNzZXR0aW5ncy5kYXJrX3RoZW1lDRZzZXR0aW5ncy5qZWxseV9waHlzaWNzDhJzZXR0aW5ncy5zaG93X21hc3MPE3NldHRpbmdzLnNob3dfc2tpbnMQGHNldHRpbmdzLnNtLmNlbGxfY29sb3IuchEYc2V0dGluZ3Muc20uY2VsbF9jb2xvci5nEhhzZXR0aW5ncy5zbS5jZWxsX2NvbG9yLmITGHNldHRpbmdzLnNtLmNlbGxfY29sb3IuYRQWc2V0dGluZ3Muc20uc2hvd19uYW1lcxUYc2V0dGluZ3Muc2YuY2FtZXJhX21lcmdlFh9zZXR0aW5ncy5zZi5jYW1lcmFfbWVyZ2Vfd2VpZ2h0FxZzZXR0aW5ncy5zZi5kcmF3X2RlbGF5GBhzZXR0aW5ncy5zZi5tYXNzX29wYWNpdHkZCXRhYi5jb3VudBoNdGFiLm1heF9jZWxscxsPdGFiLm1heF9wZWxsZXRzHBB0YWIub2Zmc2V0X293bmVkHQ90YWIud2lkdGhfY2VsbHMeDnRhYi53aWR0aF9taXNjHxF0YWIud2lkdGhfcGVsbGV0cyAPdGFiLndpZHRoX3NwYWNl';
		const buffer = await fetch(src).then(res => res.arrayBuffer());

		const memory = new WebAssembly.Memory({ initial: 27 });
		let nextStringRef = 1;
		/** @type {Map<string | number, number | string>} */
		const strings = new Map();
		const textDecoder = new TextDecoder();

		// guarantee ref=0 to be the empty string
		strings.set(0, '');
		strings.set('', 0);

		const string = {
			from_ref: ref => {
				return strings.get(ref);
			},
			to_ref: (start, end) => {
				const str = textDecoder.decode(new DataView(memory.buffer, start, end - start - 1));
				return string.to_ref_string(str);
			},
			to_ref_as_skin: (start, end) => {
				let skin = textDecoder.decode(new DataView(memory.buffer, start, end - start - 1));
				if (!skin) return 0; // empty skin
				skin = skin.replace('1%', '').replace('2%', '').replace('3%', '');
				return string.to_ref_string(`/static/skins/${skin}.png`);
			},
			to_ref_string: str => {
				const ref = strings.get(str);
				if (ref !== undefined)
					return ref;

				strings.set(str, nextStringRef);
				strings.set(nextStringRef, str);
				return nextStringRef++;
			},
		};

		const imports = {
			main: {
				memory,
			},
			string,
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
			...imports,
			module: res.module,
		}));
	})();



	/////////////////////////
	// Create Options Menu //
	/////////////////////////
	const settings = (() => {
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

		const updateWasm = () => {
			wasm['settings.sf.update'](
				settings.drawDelay,
				settings.massOpacity,
			);
		};

		try {
			Object.assign(settings, JSON.parse(localStorage.getItem('sigfix') ?? ''));
		} catch (_) { }
		updateWasm();

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
			updateWasm();
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

		return settings;
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

		const frame = new BroadcastChannel('sigfix-frame');
		const zoom = new BroadcastChannel('sigfix-zoom');
		const self = `${Date.now()}-{Math.random()}`;

		sync.zoom = () => zoom.postMessage(input.zoom);

		frame.addEventListener('message', () => {
			// only update the world if we aren't rendering ourselves (example case: games open on two monitors)
			if (document.visibilityState === 'hidden') {
				input.move();
			}

			// might be preferable over document.visibilityState
			// TODO: wtf is document.hasFocus()'s behavior?
			if (!document.hasFocus())
				input.antiAfk();
		});

		zoom.addEventListener('message', e => void (input.zoom = e.data));

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

			wasm['tab.clear'](0);
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
			wasm['camera.target'](0, 0, 1, true);

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

		let lastStatsUpdate = performance.now();
		setInterval(() => {
			const now = performance.now();
			if (now - lastStatsUpdate < 400) return;
			lastStatsUpdate = now;
			ui.stats.update(wasm['tab.score'](0), render.fps, net.latency);
		}, 500);



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
					const wasmDat = new DataView(wasm.main.memory.buffer);
					for (let i = 0; i < dat.byteLength; ++i) {
						wasmDat.setUint8(i, dat.getUint8(i));
					}
					void wasm['ws.handle_update'](0, performance.now());

					wasm['tab.cleanup'](0, now);
					lastStatsUpdate = now;
					ui.stats.update(wasm['tab.score'](0), render.fps, net.latency);

					if (wasm['tab.owned.num'](0) === 0 && world.stats.spawnedAt !== undefined)
						ui.deathScreen.show(world.stats);
					break;
				}

				case 0x11: { // update camera pos
					wasm['camera.target'](
						dat.getFloat32(off, true),
						dat.getFloat32(off + 4, true),
						dat.getFloat32(off + 8, true)
					);
					break;
				}

				case 0x12: // delete all cells
					wasm['tab.clear'](0);
				// passthrough
				case 0x14: // delete my cells
					wasm['tab.owned.clear'](0);
					break;

				case 0x20: { // new owned cell
					wasm['tab.owned.add'](0, dat.getUint32(off, true));
					if (world.stats.spawnedAt === undefined)
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
								name: inputName?.value ?? '',
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
					ui.stats.updateMisc(statData);

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
				wasm['camera.get_x']() + mouseX * (innerWidth / innerHeight) * 540 / wasm['camera.get_scale'](),
				wasm['camera.get_y']() + mouseY * 540 / wasm['camera.get_scale'](),
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
			// sync.others.forEach(data => anyAlive ||= data.owned.size > 0);
			// TODO: CHECK IF OTHER TABS ARE ALIVE
			net.qup(); // send literally any packet at all
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
			wasm['input.zoom_update'](input.zoom);
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
				float text_offset; // @ 0x18
				int text_digit_count; // @ 0x1c
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
				uniform float time;
				uniform sampler2D cell_skin;
				out vec4 out_color;

				void main() {
					float blur = 1.0 * cell_radius * (540.0 * camera_scale);
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
				time: gl.getUniformLocation(programs.cell, 'time'),
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
				out vec2 v_uv;

				void main() {
					v_pos = a_pos;
					v_uv = v_pos * 0.5 + 0.5;
					if (text_digit_count > 0) {
						v_uv.x *= float(text_digit_count);
					}

					vec2 clip_space = v_pos * text_scale + vec2(0, text_offset);
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
				in vec2 v_uv;
				${cameraBlock}
				${textBlock}
				uniform sampler2D text_colored;
				uniform sampler2D text_silhouette;
				uniform sampler2D text_digits[6];
				out vec4 out_color;

				void main() {
					float c2_alpha = (v_uv.x + v_uv.y) / 2.0;
					vec4 color = text_color1 * (1.0 - c2_alpha) + text_color2 * c2_alpha;
					vec4 normal = vec4(0, 0, 0, 0);

					if (text_digit_count == 0) {
						normal = texture(text_colored, v_uv);
					} else {
						// remap 0 <= v_uv <= 1 to 0.125 <= v_uv.x <= 0.875, otherwise too much kerning
						vec2 local_uv = vec2(mod(v_uv.x, 1.0) * 0.75 + 0.125, v_uv.y);
						normal = texture(text_digits[0], local_uv);
					}

					if (text_silhouette_enabled != 0) {
						vec4 silhouette = texture(text_silhouette, v_uv);

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

			// update texture uniforms
			gl.useProgram(programs.text);
			gl.uniform1i(gl.getUniformLocation(programs.text, 'text_silhouette'), 1);
			gl.uniform1iv(gl.getUniformLocation(programs.text, 'text_digits'), new Int32Array([ 2, 3, 4, 5, 6, 7 ]));

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
	const started = performance.now();
	const render = (() => {
		const render = {};
		const { gl } = ui.game;

		render.debug = false;
		let now = performance.now();

		// #1 : define text texture manager
		const textCanvas = document.createElement('canvas');
		render.textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
		render.textCache = [];

		const drawText = (text, silhouette, bold, size) => {
			const lineWidth = Math.ceil(size / 10);

			render.textCtx.font = `${bold ? 'bold' : ''} ${size}px Ubuntu`;

			textCanvas.width = lineWidth * 2 + render.textCtx.measureText(text).width; // setting width and height clears the canvas
			textCanvas.height = size * 3; // it also seems to reset the ctx state

			render.textCtx.font = `${bold ? 'bold' : ''} ${size}px Ubuntu`;
			render.textCtx.lineWidth = lineWidth;
			render.textCtx.fillStyle = silhouette ? '#000' : '#fff';
			render.textCtx.lineJoin = 'round';
			render.textCtx.strokeStyle = '#000';
			render.textCtx.textBaseline = 'middle';

			// add a space, to prevent sigmod detecting the name and adjusting colors
			render.textCtx.strokeText(text + ' ', lineWidth, size * 1.5);
			render.textCtx.fillText(text + ' ', lineWidth, size * 1.5);

			const canvasExport = render.textCtx.getImageData(0, 0, textCanvas.width, textCanvas.height);
			const texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasExport);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR); // sharp but not crispy
			gl.generateMipmap(gl.TEXTURE_2D);
			return texture;
		};

		const TEXT_TYPE_NAME = 0;
		const TEXT_TYPE_MASS = 1;
		const TEXT_TYPE_CLAN = 2;
		const TEXT_TYPE_MINIMAP = 3;

		render.text = (ref, silhouetted, type) => {
			const cached = render.textCache[ref];
			if (silhouetted ? cached?.silhouette : cached) {
				cached.accessed = now;
				return cached;
			}

			const text = wasm.string.from_ref(ref);
			let bold, scale;
			if (type === TEXT_TYPE_NAME) {
				bold = settings.nameBold;
				scale = Math.floor(96 * settings.nameScaleFactor);
			} else if (type === TEXT_TYPE_MINIMAP) {
				bold = false;
				scale = Math.floor(200 / 15 * devicePixelRatio); // 200 is the minimap width and height
			} else if (type === TEXT_TYPE_CLAN) {
				bold = false;
				scale = Math.floor(96 * 0.5); // no seting yet
			} else { // type === TEXT_TYPE_MASS
				bold = settings.massBold;
				scale = Math.floor(96 * 0.5 * settings.massScaleFactor);
			}

			const colored = drawText(text, false, bold, scale);
			const silhouette = silhouetted && drawText(text, true, bold, scale);
			return render.textCache[ref] = { ratio: textCanvas.width / textCanvas.height, colored, silhouette, accessed: now };
		};

		let massDigits = [];
		let massRatio = 1;
		render.clearText = () => {
			for (const entry of render.textCache) {
				if (!entry) continue;
				gl.deleteTexture(entry.colored);
				if (entry.silhouette) gl.deleteTexture(entry.silhouette);
			}
			render.textCache = [];
			massDigits = '0123456789'.split('')
				.map(digit => render.text(wasm.string.to_ref_string(Number(digit)), false, TEXT_TYPE_MASS));
			massRatio = textCanvas.width / textCanvas.height; // scary reliance on side effects?
		}
		render.clearText(); // pre-generate massDigits so we don't ever need to check if they exist
		document.fonts.ready.then(() => render.clearText());

		// #2 : define image texture manager
		render.imageCache = [];
		render.image = ref => {
			const cached = render.imageCache[ref];
			if (cached !== undefined) {
				if (cached)
					cached.accessed = now;
				return cached;
			}

			const image = new Image();
			image.crossOrigin = 'anonymous'; // allow images outside of sigmally.com
			image.addEventListener('load', () => {
				gl.bindTexture(gl.TEXTURE_2D, render.imageCache[ref] = gl.createTexture());
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST); // not sharp, not blurry
				gl.generateMipmap(gl.TEXTURE_2D);
			});
			image.src = wasm.string.from_ref(ref);

			return render.imageCache[ref] = false;
		};

		// #3 : define minimap helpers
		let lastMinimapDraw = performance.now();
		render.minimapBase = undefined;
		render.drawMinimapBase = () => {
			// text needs to be small and sharp, i don't trust webgl with that, so we use a 2d context
			const { canvas, ctx } = ui.minimap;
			canvas.width = canvas.height = 200 * devicePixelRatio; // clears the canvas
			const sectorSize = canvas.width / 5;

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

			render.minimapBase = ctx.getImageData(0, 0, canvas.width, canvas.height);
		};
		render.drawMinimapBase();
		document.fonts.ready.then(() => render.drawMinimapBase());

		setInterval(() => {
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

			ui.minimap.canvas.style.display = aux.setting('input#showMinimap', true) ? '' : 'none';
		}, 200);

		// #4 : define base textures
		// no point in breaking this across multiple lines
		// eslint-disable-next-line max-len
		const gridRef = wasm.string.to_ref_string('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IArs4c6QAAAKVJREFUaEPtkkEKwlAUxBzw/jeWL4J4gECkSrqftC/pzjnn9gfP3ofcf/mWbY8OuVLBilypxutbKlIRyUC/liQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNKyIJBZjK4LVScOKSGIxtiJYnTSsiCQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNPwU2TbpHV/DPgFxJfgvliP9RQAAAABJRU5ErkJggg==');
		render.image(gridRef);

		const virusRef = wasm.string.to_ref_string('/assets/images/viruses/2.png');
		wasm['render.update_virus_ref'](virusRef);
		render.image(virusRef);

		// #5 : define the render function
		render.fps = 0;
		let lastFrame = performance.now();
		function renderGame() {
			now = performance.now();
			const dt = Math.max(now - lastFrame, 0.1) / 1000; // there's a chance (now - lastFrame) can be 0
			render.fps += (1 / dt - render.fps) / 10;
			lastFrame = now;

			if (gl.isContextLost()) {
				requestAnimationFrame(renderGame);
				return;
			}

			// when tabbing in, draw *as fast as possible* to prevent flickering effects
			// i'd imagine people using sigmally fixes won't have their fps naturally go below 20 anyway
			const fastDraw = dt >= 0.05;

			const darkTheme = aux.setting('input#darkTheme', true);
			const showBorder = aux.setting('input#showBorder', true);
			const showGrid = aux.setting('input#showGrid', true);
			const showMass = aux.setting('input#showMass', false);
			const showNames = aux.setting('input#showNames', true);
			const showSkins = aux.setting('input#showSkins', true);
			const jellyPhysics = aux.setting('input#jellyPhysics', false);

			/** @type {HTMLInputElement | null} */
			const nickElement = document.querySelector('input#nick');
			const nick = nickElement?.value ?? '?';

			// note: most routines are named, for benchmarking purposes
			(function updateCells() {
				input.move();
			})();

			(function setGlobalUniforms() {
				const aspectRatio = ui.game.canvas.width / ui.game.canvas.height;

				wasm['camera.update'](0, now);
				const cameraData = new Float32Array([
					aspectRatio, wasm['camera.get_scale']() / 540, // (height of 1920x1080 / 2 = 540)
					wasm['camera.get_x'](), wasm['camera.get_y'](),
				]);

				[uniforms.bg.camera, uniforms.cell.camera, uniforms.cellGlow.camera,
					uniforms.text.camera, uniforms.tracer.camera].forEach(ubo => {
						gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cameraData);
					});

				// textures are usually initialized to TEXTURE0, but we need TEXTURE1
				gl.useProgram(programs.text);
				gl.uniform1i(uniforms.text.text_silhouette, 1);

				// experiment
				gl.useProgram(programs.cell);
				gl.uniform1f(uniforms.cell.time, (now - started) / 1000 % (2*3*5*7*11*13*17));
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

				const gridTexture = render.image(gridRef);
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
				const updateUniforms = (glbuf, view) => {
					gl.bindBuffer(gl.UNIFORM_BUFFER, glbuf);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, view);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null); // required, otherwise the uniform buffer blanks out when used again
				};

				const { cellColor, foodColor, outlineColor, skinReplacement } = aux.sigmodSettings ?? {};

				gl.useProgram(programs.cell);
				gl.bindTexture(gl.TEXTURE_2D, null);

				wasm['tab.sort'](0, now);
				let cellPtr = wasm['cell.first_pellet_ptr'](0);
				let numCells = wasm['cell.num_pellets'](0);
				const cellView = new DataView(wasm.main.memory.buffer, wasm['render.cell_ubo_ptr'](), 0x5c);
				const textView = new DataView(wasm.main.memory.buffer, wasm['render.text_ubo_ptr'](), 0x44);
				for (let i = 0; i < numCells; ++i, cellPtr += 128) {
					wasm['render.cell_ubo'](0, cellPtr, now, true);
					updateUniforms(uniforms.cell.cell, cellView);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				}

				cellPtr = wasm['cell.first_cell_ptr'](0);
				numCells = wasm['cell.num_cells'](0);
				for (let i = 0; i < numCells; ++i, cellPtr += 128) {
					// cell
					gl.useProgram(programs.cell);

					const skinRef = wasm['render.cell_ubo'](0, cellPtr, now, false);
					let texture = skinRef && render.image(skinRef);
					gl.bindTexture(gl.TEXTURE_2D, texture || null);
					if (!texture && skinRef) cellView.setUint32(0x54, 0, true); // if skin hasn't loaded yet, turn it off

					updateUniforms(uniforms.cell.cell, cellView);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

					// text
					gl.useProgram(programs.text);
					wasm['render.text_ubo_basics'](cellPtr, now);

					const nameRef = wasm['render.text_ubo_name'](cellPtr, now);
					if (nameRef) {
						const textureData = render.text(nameRef, false, TEXT_TYPE_NAME);
						textView.setFloat32(0x10, textureData.ratio, true);
						gl.bindTexture(gl.TEXTURE_2D, textureData.colored);
						updateUniforms(uniforms.text.text, textView);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					}

					const mass = wasm['render.text_ubo_mass'](cellPtr, now);
					if (mass > 0) {
						const stringified = mass.toString();
						for (let i = 0; i < stringified.length; ++i) {
							gl.activeTexture(gl.TEXTURE2 + i);
							gl.bindTexture(gl.TEXTURE_2D, massDigits[stringified[i]].colored);
						}
						gl.activeTexture(gl.TEXTURE0);
						// text is squished horizontally by a factor of 0.75
						textView.setFloat32(0x10, massRatio * stringified.length * 0.75, true);
						updateUniforms(uniforms.text.text, textView);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					}
				}

				gl.bindTexture(gl.TEXTURE_2D, null);
			})();

			(function minimap() {
				if (fastDraw) return;
				if (now - lastMinimapDraw < 40) return;
				lastMinimapDraw = now;

				if (!showMinimap) return;

				// text needs to be small and sharp, i don't trust webgl with that, so we use a 2d context
				const { canvas, ctx } = ui.minimap;

				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.putImageData(render.minimapBase, 0, 0);

				const { border } = world;
				if (!border) return;
				const gameWidth = border.r - border.l;
				const gameHeight = border.b - border.t;

				// highlight current section
				ctx.fillStyle = '#ff0';
				ctx.globalAlpha = 0.3;

				const sectionX = Math.floor((wasm['camera.get_x']() - border.l) / gameWidth * 5);
				const sectionY = Math.floor((wasm['camera.get_y']() - border.t) / gameHeight * 5);
				const sectorSize = canvas.width / 5;
				ctx.fillRect(sectionX * sectorSize, sectionY * sectorSize, sectorSize, sectorSize);

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
					const x = (wasm['camera.get_x']() - border.l) / gameWidth * canvas.width;
					const y = (wasm['camera.get_y']() - border.t) / gameHeight * canvas.height;

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

			render.debug = false;

			requestAnimationFrame(renderGame);
		}

		requestAnimationFrame(renderGame);
		return render;
	})();



	// @ts-expect-error for debugging purposes. dm me on discord @8y8x to work out stability if you need something
	window.sigfix = {
		destructor, aux, ui, settings, sync, world, net, gl: { init: initWebGL, programs, uniforms }, render, wasm,
	};
})();
