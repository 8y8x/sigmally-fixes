// ==UserScript==
// @name         Sigmally Fixes V2
// @version      2024-02-28
// @description  Massive performance improvements, bug fixes for Sigmally.com - supports SigMod
// @author       8y8x
// @match        https://sigmally.com/
// @icon         https://8y8x.dev/favicon.ico
// @license      MIT
// @grant        none
// @namespace https://8y8x.dev/sigmally-fixes
// @downloadURL https://update.greasyfork.org/scripts/483587/Sigmally%20Fixes%20V2.user.js
// @updateURL https://update.greasyfork.org/scripts/483587/Sigmally%20Fixes%20V2.meta.js
// ==/UserScript==

// @ts-check
'use strict';

(async () => {
	////////////////////////////////
	// Define Auxiliary Functions //
	////////////////////////////////
	const aux = (() => {
		const aux = {};

		/**
		 * consistent exponential easing relative to 60fps
		 * @param {number} o
		 * @param {number} n
		 * @param {number} factor
		 * @param {number} dt in seconds
		 */
		aux.exponentialEase = (o, n, factor, dt) => {
			return o + (n - o) * (1 - (1 - 1 / factor)**(60 * dt));
		};

		/** @param {[number, number, number]} rgb */
		aux.rgb2hex = rgb => {
			return [
				'#',
				Math.floor(rgb[0] * 255).toString(16).padStart(2, '0'),
				Math.floor(rgb[1] * 255).toString(16).padStart(2, '0'),
				Math.floor(rgb[2] * 255).toString(16).padStart(2, '0'),
			].join('');
		};

		/**
		 * @param {string} name
		 * @param {string} skin
		 */
		aux.parseNameSkin = (name, skin) => {
			const match = /^\{(.*?)\}(.*)$/.exec(name);
			if (match) {
				skin ||= match[1];
				name = match[2] || 'An unnamed cell';
			} else {
				name ||= 'An unnamed cell';
			}

			if (skin) {
				skin = skin.replace('1%', '').replace('2%', '').replace('3%', '');
				skin = '/static/skins/' + skin + '.png';
			}

			return { name, skin };
		};

		/**
		 * Only changes sometimes, like when your skin is updated
		 * @type {object | undefined}
		 */
		aux.settings = undefined;
		setInterval(() => {
			try {
				aux.settings = JSON.parse(localStorage.getItem('settings') ?? '');
			} catch (_) {}
		}, 50);

		/** @type {object | undefined} */
		aux.userData = undefined;
		// this is the best method i've found to get the userData object, since game.js uses strict mode
		window.fetch = new Proxy(fetch, {
			apply: (target, thisArg, args) => {
				let url = args[0];
				if (typeof url !== 'string') return target.apply(thisArg, args);
				// fix: game.js doesn't think we're connected to a server, we default to eu0 because that's the default
				// everywhere else
				if (url.includes('/userdata/')) args[0] = url.replace('///', '//eu0.sigmally.com/server/');

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
							aux.userData = obj?.body?.user ?? aux.userData;
							return obj;
						});
					},
				}));
			}
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
		window.requestAnimationFrame = function(fn) {
			try {
				throw new Error();
			} catch (err) {
				// prevent drawing the game, but do NOT prevent saving settings (which is called on RQA)
				if (!err.stack.includes('/game.js') || err.stack.includes('HTMLInputElement'))
					return oldRQA(fn);
			}

			return -1;
		}

		// #2 : kill access to using a WebSocket
		const realWebSocket = WebSocket;
		window.WebSocket = new Proxy(WebSocket, {
			construct(_target, argArray, _newTarget) {
				if (argArray[0]?.includes('sigmally.com')) {
					throw new Error('Nope :) - hooked by Sigmally Fixes');
				}

				// @ts-expect-error
				return new oldWS(...argArray);
			}
		});

		/** @type {WeakSet<WebSocket>} */
		const safeWebSockets = new WeakSet();
		let realWsSend = WebSocket.prototype.send;
		WebSocket.prototype.send = function() {
			if (!safeWebSockets.has(this) && this.url.includes('sigmally.com')) {
				this.onclose = null;
				this.close();
				throw new Error('Nope :) - hooked by Sigmally Fixes');
			}

			return realWsSend.apply(this, arguments);
		};

		// #3 : block play and spectate buttons from working (they show extra captchas)
		let captchaInterval;
		captchaInterval = setInterval(() => {
			const grecaptcha = /** @type {any} */ (window).grecaptcha;
			if (!grecaptcha) return;

			clearInterval(captchaInterval);
			/** @type {any} */ (window).grecaptcha = new Proxy(grecaptcha, {
				get: (_target, prop, _receiver) => {
					if (prop === 'execute') return () => new Promise(_ => {});

					return grecaptcha[prop];
				},
			});
		}, 50);

		// #4 : prevent keys from being registered by the game
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
			watermark.innerHTML = '<a href="https://greasyfork.org/en/scripts/483587">Sigmally Fixes</a> by yx';
			title.insertAdjacentElement('afterend', watermark);
		})();

		ui.game = (() => {
			const game = {};
			/** @type {HTMLCanvasElement | null} */
			const oldCanvas = document.querySelector('canvas#canvas');
			if (!oldCanvas)
				throw new Error('Couldn\'t find canvas');

			// leave the old canvas so the old client can actually run
			oldCanvas.style.display = 'none';
			/** @type {HTMLCanvasElement} */
			const newCanvas = /** @type {any} */ (oldCanvas.cloneNode());
			newCanvas.id = '';
			newCanvas.style.cssText = `background: #003; width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;
				z-index: 1;`;
			(document.querySelector('.body__inner') ?? document.body).appendChild(newCanvas);
			game.canvas = newCanvas;

			// forward macro inputs from the canvas to the old one - this is for sigmod mouse controls
			newCanvas.addEventListener('mousedown', e => oldCanvas.dispatchEvent(new MouseEvent('mousedown', e)));
			newCanvas.addEventListener('mouseup', e => oldCanvas.dispatchEvent(new MouseEvent('mouseup', e)));

			const gl = newCanvas.getContext('webgl2');
			if (!gl) {
				alert('Your browser does not support WebGL2. Please use a different one, or disable Sigmally Fixes.');
				throw new Error('Couldn\'t get WebGL2 context');
			}

			game.gl = gl;

			game.viewportScale = 1;
			function resize() {
				newCanvas.width = Math.floor(innerWidth * devicePixelRatio);
				newCanvas.height = Math.floor(innerHeight * devicePixelRatio);
				game.viewportScale = Math.max(innerWidth / 1920, innerHeight / 1080);
				game.gl.viewport(0, 0, newCanvas.width, newCanvas.height);
			}

			addEventListener('resize', resize);
			resize();

			return game;
		})();

		// TODO: text needs to turn black when using light theme
		ui.stats = (() => {
			const container = document.createElement('div');
			container.style.cssText = `position: fixed; top: 10px; left: 10px; width: 400px; height: fit-content;
				user-select: none; z-index: 2; transform-origin: top left;`;
			document.body.appendChild(container);

			const score = document.createElement('div');
			score.style.cssText = `font-family: Ubuntu; font-size: 30px; color: #fff; line-height: 1.0;`;
			container.appendChild(score);

			const measures = document.createElement('div');
			measures.style.cssText = `font-family: Ubuntu; font-size: 20px; color: #fff; line-height: 1.1;`;
			container.appendChild(measures);

			const misc = document.createElement('div');
			// white-space: pre; allows using \r\n to insert line breaks
			misc.style.cssText = `font-family: Ubuntu; font-size: 14px; color: #fff; white-space: pre;
				line-height: 1.1; opacity: 0.5;`;
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
				let color = '#fff';

				/** @type {HTMLInputElement | null} */
				const darkTheme = document.querySelector('input#darkTheme');
				if (darkTheme && !darkTheme.checked)
					color = '#000';

				score.style.color = color;
				measures.style.color = color;
				misc.style.color = color;
			}

			matchTheme();

			return { container, score, measures, misc, update, matchTheme };
		})();

		ui.leaderboard = (() => {
			const container = document.createElement('div');
			container.style.cssText = `position: fixed; top: 10px; right: 10px; width: 200px; height: fit-content;
				user-select: none; z-index: 2; background: #0006; padding: 15px 5px; transform-origin: top right;
				display: none;`;
			document.body.appendChild(container);

			const title = document.createElement('div');
			title.style.cssText = `font-family: Ubuntu; font-size: 30px; color: #fff; text-align: center; width: 100%;`;
			title.textContent = 'Leaderboard';
			container.appendChild(title);

			const linesContainer = document.createElement('div');
			linesContainer.style.cssText = `font-family: Ubuntu; font-size: 20px; line-height: 1.2; width: 100%;
				height: fit-content; text-align: center; white-space: pre; overflow-x: hidden;`;
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
					line.textContent = `${entry.place ?? i + 1}. ${entry.name}`;
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

		/** @type {HTMLElement | null} */
		const mainMenu = document.querySelector('#__line1')?.parentElement ?? null;
		if (!mainMenu) throw new Error('Can\'t find main menu');
		/** @type {HTMLElement | null} */
		const menuLinks = document.querySelector('#menu-links');
		/** @type {HTMLElement | null} */
		const overlay = document.querySelector('#overlays');

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

				ui.deathScreen.hide();
			} else {
				mainMenu.style.display = 'none';
				if (overlay) overlay.style.display = 'none';
				if (menuLinks) menuLinks.style.display = 'none';
			}
		};

		ui.escOverlayVisible = () => escOverlayVisible;

		ui.deathScreen = (() => {
			const deathScreen = {};

			const statsContainer = document.querySelector('#__line2');
			const continueButton = /** @type {HTMLElement | null} */ (document.querySelector('#continue_button'));
			if (continueButton) {
				continueButton.addEventListener('click', () => {
					setTimeout(() => ui.toggleEscOverlay(true));
				});
			}

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

					timeAliveElement.textContent =  `${hours ? hours + ' h' : ''} ${mins ? mins + ' m' : ''} `
						+ `${seconds ? seconds + ' s' : ''}`;
				}

				statsContainer?.classList.remove('line--hidden');
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
			canvas.style.cssText = `position: absolute; bottom: 0; right: 0; background: #0006; width: 200px;
				height: 200px; z-index: 2; user-select: none;`;
			canvas.width = canvas.height = 200;
			document.body.appendChild(canvas);

			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Can\'t get 2d context for minimap');

			return { canvas, ctx };
		})();

		ui.chat = (() => {
			const chat = {};

			const style = document.createElement('style');
			style.id = 'sigmally-fixes-style';
			style.innerHTML = `
			`;
			document.head.appendChild(style);

			const block = document.querySelector('#chat_block');
			if (!block) throw new Error('Can\'t find #chat_block');

			/**
			 * @param {ParentNode} root
			 * @param {string} selector
			 */
			function clone(root, selector) {
				const old = root.querySelector(selector);
				if (!old) throw new Error(`Can't find element ${selector}`);

				const el = /** @type {HTMLElement} */ (old.cloneNode(true));
				el.id = '';
				old.replaceWith(el);

				return el;
			}

			// elements grabbed with clone() are only styled by their class, not id
			const toggle = chat.toggle = clone(document, '#chat_vsbltyBtn');
			const input = chat.input = /** @type {HTMLInputElement} */ (document.querySelector('#chat_textbox'));
			const scrollbar = chat.scrollbar = clone(document, '#chat_scrollbar');
			const thumb = chat.thumb = clone(scrollbar, '#chat_thumb');

			if (!input) throw new Error('Can\'t find element #chat_textbox');

			const list = chat.list = document.createElement('div');
			list.style.cssText = `width: 400px; height: 182px; position: absolute; bottom: 54px; left: 46px;
				overflow: hidden; user-select: none; z-index: 301;`;
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
			 * @param {[number, number, number]} rgb
			 * @param {string} text
			 */
			chat.add = (authorName, rgb, text) => {
				lastWasBarrier = false;

				const container = document.createElement('div');
				const author = document.createElement('span');
				author.style.cssText = `color: ${aux.rgb2hex(rgb)}; padding-right: 0.75em;`;
				author.textContent = authorName ? aux.parseNameSkin(authorName, '').name : 'Unnamed';
				container.appendChild(author);

				const msg = document.createElement('span');
				msg.textContent = text;
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
				/** @type {HTMLInputElement | null} */
				const darkTheme = document.querySelector('input#darkTheme');
				if (!darkTheme || darkTheme.checked) {
					list.style.color = '#fffc';
				} else {
					list.style.color = '#000c';
				}
			};

			return chat;
		})();

		return ui;
	})();



	///////////////////////////
	// Setup World Variables //
	///////////////////////////
	/** @typedef {{
	 * id: number,
	 * x: number, ox: number, nx: number,
	 * y: number, oy: number, ny: number,
	 * r: number, or: number, nr: number,
	 * rgb: [number, number, number],
	 * updated: number, born: number, dead: { to: Cell | undefined, at: number } | undefined,
	 * jagged: boolean,
	 * name: string, skin: string, sub: boolean,
	 * jelly: { x: number, y: number, r: number },
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

		/**
		 * @param {Cell} cell
		 * @param {number} now
		 * @param {number | undefined} dt
		 */
		world.move = function(cell, now, dt) {
			const a = Math.min(Math.max((now - cell.updated) / 120, 0), 1);
			let nx = cell.nx;
			let ny = cell.ny;
			if (cell.dead?.to) {
				nx = cell.dead.to.x;
				ny = cell.dead.to.y;
			}

			cell.x = cell.ox + (nx - cell.ox) * a;
			cell.y = cell.oy + (ny - cell.oy) * a;
			cell.r = cell.or + (cell.nr - cell.or) * a;

			if (dt !== undefined) {
				cell.jelly.x = aux.exponentialEase(cell.jelly.x, cell.x, 2, dt);
				cell.jelly.y = aux.exponentialEase(cell.jelly.y, cell.y, 2, dt);
				cell.jelly.r = aux.exponentialEase(cell.jelly.r, cell.r, 5, dt);
			}
		}

		// clean up dead cells
		setInterval(() => {
			const now = performance.now();
			world.cells.forEach((cell, id) => {
				if (!cell.dead) return;
				if (now - cell.dead.at >= 120) {
					world.cells.delete(id);
				}
			});
		}, 100);



		// #2 : define others, like camera and borders
		world.camera = {
			x: 0, tx: 0,
			y: 0, ty: 0,
			scale: 1, tscale: 1,
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
		/** @type {Symbol | undefined} */
		let connection = undefined;
		/** @type {{ shuffle: Map<number, number>, unshuffle: Map<number, number> } | undefined} */
		let handshake;
		/** @type {number | undefined} */
		let pendingPingFrom;
		let pingInterval;
		let reconnectAttempts = 0;
		/** @type {WebSocket} */
		let ws;

		/** -1 if ping reply took too long @type {number | undefined} */
		net.latency = undefined;
		net.ready = false;

		// #2 : connecting/reconnecting the websocket
		/** @type {HTMLSelectElement | null} */
		const gamemode = document.querySelector('#gamemode');
		if (!gamemode)
			console.warn('#gamemode element no longer exists, falling back to us-1');

		function connect() {
			let server = gamemode?.value ?? 'us0.sigmally.com/ws/';
			if (location.search.startsWith('?ip='))
				server = location.search.slice('?ip='.length); // in csrf we trust

			ws = new destructor.realWebSocket('wss://' + server);
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

			connection = undefined;
			net.latency = undefined;
			net.ready = false;

			// hide/clear UI
			ui.stats.misc.textContent = '';
			world.leaderboard = [];
			ui.leaderboard.update();

			// clear world
			world.border = undefined;
			world.cells.clear(); // make sure we won't see overlapping IDs from new cells from the new connection
			world.clanmates.clear();
			while (world.mine.length) world.mine.pop();

			setTimeout(connect, 500 * Math.min(reconnectAttempts++ + 1, 10));
		}

		/** @param {Event} err */
		function wsError(err) {
			console.warn('WebSocket error:', err);
		}

		function wsOpen() {
			reconnectAttempts = 0;
			connection = Symbol();

			ui.chat.barrier();

			// reset camera location to the middle; this is implied but never sent by the server
			world.camera.x = world.camera.tx = 0;
			world.camera.y = world.camera.ty = 0;
			world.camera.scale = world.camera.tscale = 1;

			ws.send(new TextEncoder().encode('SIG 0.0.1\x00'));
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

			return [new TextDecoder('utf-8').decode(dat.buffer.slice(startOff, off)), off + 1];
		}

		/**
		 * @param {number} opcode
		 * @param {object} data
		 */
		function sendJson(opcode, data) {
			if (!handshake) return;
			const dataBuf = new TextEncoder().encode(JSON.stringify(data));
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

				ws.send(new Uint8Array([ Number(handshake.shuffle.get(0xfe)) ]));
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
					// #a : kills / consumes
					const killCount = dat.getUint16(off, true);
					off += 2;

					for (let i = 0; i < killCount; ++i) {
						const killerId = dat.getUint32(off, true);
						const killedId = dat.getUint32(off + 4, true);
						off += 8;

						const killer = world.cells.get(killerId);
						const killed = world.cells.get(killedId);
						if (killed) {
							killed.dead = { to: killer, at: now };
							killed.updated = now;

							if (killed.r <= 20 && world.mine.includes(killerId))
								++world.stats.foodEaten;

							const myIdx = world.mine.indexOf(killedId);
							if (myIdx !== -1)
								world.mine.splice(myIdx, 1);

							world.clanmates.delete(killed);
						}
					}

					// #b : updates
					while (true) {
						const id = dat.getUint32(off, true);
						off += 4;
						if (id === 0) break;

						const x = dat.getInt16(off, true);
						const y = dat.getInt16(off + 2, true);
						const r = dat.getInt16(off + 4, true);
						const flags = dat.getUint8(off + 6);
						// (void 1 byte, "isUpdate")
						// (void 1 byte, "isPlayer")
						const sub = !!dat.getUint8(off + 9);
						off += 10;

						let clan; [clan, off] = readZTString(dat, off);

						/** @type {[number, number, number] | undefined} */
						let rgb;
						if (flags & 0x02) {
							// update color
							rgb = [dat.getUint8(off) / 255, dat.getUint8(off + 1) / 255, dat.getUint8(off + 2) / 255];
							off += 3;
						}

						let skin = '';
						if (flags & 0x04) {
							// update skin
							[skin, off] = readZTString(dat, off);
						}

						let name = '';
						if (flags & 0x08) {
							// update name
							[name, off] = readZTString(dat, off);
						}

						const jagged = !!(flags & 0x11);

						const cell = world.cells.get(id);
						if (cell && !cell.dead) {
							// update cell.x and cell.y, to prevent rubber banding effect when tabbing out for a bit
							world.move(cell, now, undefined);

							cell.ox = cell.x; cell.oy = cell.y; cell.or = cell.r;
							cell.nx = x; cell.ny = y; cell.nr = r; cell.sub = sub;
							cell.jagged = jagged;
							cell.updated = now;

							if (rgb) cell.rgb = rgb;
							if (skin) cell.skin = skin;
							if (name) cell.name = name;

							if (clan && clan === aux.settings?.clan)
								world.clanmates.add(cell);
						} else {
							if (r > 20 && !(flags & 0x20)) { // not pellet, not ejected
								({ name, skin } = aux.parseNameSkin(name, skin));
							}

							/** @type {Cell} */
							const cell = {
								id,
								x, ox: x, nx: x,
								y, oy: y, ny: y,
								r, or: r, nr: r,
								rgb: rgb ?? [1, 1, 1],
								updated: now, born: now, dead: undefined,
								jagged,
								name, skin, sub,
								jelly: { x, y, r },
							};

							world.cells.set(id, cell);

							if (clan && clan === aux.settings?.clan)
								world.clanmates.add(cell);
						}
					}

					// #c : deletes
					const deleteCount = dat.getUint16(off, true);
					off += 2;

					for (let i = 0; i < deleteCount; ++i) {
						const deletedId = dat.getUint32(off, true);
						off += 4;

						const deleted = world.cells.get(deletedId);
						if (deleted)
							deleted.dead = { to: undefined, at: now };
					}

					break;
				}

				case 0x11: { // update camera pos
					world.camera.tx = dat.getFloat32(off, true);
					world.camera.ty = dat.getFloat32(off + 4, true);
					world.camera.tscale = dat.getFloat32(off + 8, true) * ui.game.viewportScale * input.zoom;
					break;
				}

				case 0x12: // delete all cells
					world.cells.forEach(cell => {
						cell.dead ??= { to: undefined, at: now };
					});
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
						name = aux.parseNameSkin(name, '').name;

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
							lb.push({ name: aux.parseNameSkin(inputName?.value ?? '', '').name, sub: false, me: true, place: myPosition });
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
					const rgb = /** @type {[number, number, number]} */
						([dat.getUint8(off + 1) / 255, dat.getUint8(off + 2) / 255, dat.getUint8(off + 3) / 255]);
					off += 4;

					let name;
					[name, off] = readZTString(dat, off);
					let msg;
					[msg, off] = readZTString(dat, off);

					ui.chat.add(name, rgb, msg);
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
		net.move = function(x, y) {
			if (!handshake) return;
			const buf = new ArrayBuffer(13);
			const dat = new DataView(buf);

			dat.setUint8(0, Number(handshake.shuffle.get(0x10)));
			dat.setInt32(1, x, true);
			dat.setInt32(5, y, true);

			ws.send(buf);
		}

		net.w = function() {
			if (!handshake) return;
			ws.send(new Uint8Array([ Number(handshake.shuffle.get(21)) ]));
		}

		net.qdown = function() {
			if (!handshake) return;
			ws.send(new Uint8Array([ Number(handshake.shuffle.get(18)) ]));
		}

		net.qup = function() {
			if (!handshake) return;
			ws.send(new Uint8Array([ Number(handshake.shuffle.get(19)) ]));
		}

		net.split = function() {
			if (!handshake) return;
			ws.send(new Uint8Array([ Number(handshake.shuffle.get(17)) ]));
		}

		/**
		 * @param {string} msg
		 */
		net.chat = function(msg) {
			if (!handshake) return;
			const msgBuf = new TextEncoder().encode(msg);

			const buf = new ArrayBuffer(msgBuf.byteLength + 3);
			const dat = new DataView(buf);

			dat.setUint8(0, Number(handshake.shuffle.get(0x63)));
			// skip byte #1, seems to require authentication + not implemented anyway
			for (let i = 0; i < msgBuf.byteLength; ++i)
				dat.setUint8(2 + i, msgBuf[i]);

			ws.send(buf);
		}

		/**
		 * @param {string | undefined} v2
		 * @param {string | undefined} v3
		 */
		net.captcha = function(v2, v3) {
			sendJson(0xdc, { recaptchaV2Token: v2, recaptchaV3Token: v3 });
		}

		/**
		 * @param {{ name: string, skin: string, [x: string]: any }} data
		 */
		net.play = function(data) {
			sendJson(0x00, data);
		}

		net.howarewelosingmoney = function() {
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
		}

		net.connection = function() {
			if (!ws) return undefined;
			if (ws.readyState !== WebSocket.OPEN) return undefined;
			if (!handshake) return undefined;
			return connection;
		}



		connect();
		return net;
	})();



	//////////////////////////
	// Setup Input Handlers //
	//////////////////////////
	const input = (() => {
		const input = {};

		// #1 : general inputs
		// sigmod's macro feed runs at a slower interval but presses many times in that interval. allowing queueing 2 w
		// presses makes it faster (it would be better if people disabled that macro, but no one would do that)
		let forceW = 0;
		let mouseX = 960;
		let mouseY = 540;
		let w = false;

		input.zoom = 1;

		function mouse() {
			net.move(
				world.camera.x + (mouseX - innerWidth / 2) / ui.game.viewportScale / world.camera.scale,
				world.camera.y + (mouseY - innerHeight / 2) / ui.game.viewportScale / world.camera.scale,
			);
		}

		function unfocused() {
			return ui.escOverlayVisible() || document.activeElement?.tagName === 'INPUT';
		}

		setInterval(() => {
			mouse();
			if (forceW) {
				--forceW;
				net.w();
			} else if (w) net.w();
		}, 40);

		addEventListener('mousemove', e => {
			if (ui.escOverlayVisible()) return;
			// fix for sigmod (<=8.5.5.4)'s broken randomPos() function, which spazzes your mouse
			// all other mouse movements orchestrated by sigmod are targetted at the canvas
			if (!e.isTrusted && e.target === document) return;
			mouseX = e.clientX;
			mouseY = e.clientY;
		});

		addEventListener('wheel', e => {
			if (unfocused()) return;
			input.zoom *= 0.8 ** (e.deltaY / 100);
			input.zoom = Math.min(Math.max(input.zoom, 0.1), 10);
		});

		addEventListener('keydown', e => {
			if (unfocused()) {
				if (document.activeElement === ui.chat.input) {
					if (e.code === 'Enter' && ui.chat.input.value.length > 0) {
						net.chat(ui.chat.input.value.slice(0, 15));
						ui.chat.input.value = '';
						ui.chat.input.blur();
					} else if (e.code === 'Escape') {
						ui.chat.input.blur();
					}
				}

				return;
			}

			switch (e.code) {
				case 'KeyQ':
					if (!e.repeat)
						net.qdown();
					break;
				case 'KeyW':
					w = true;
					forceW = Math.min(forceW + 1, 2);
					break;
				case 'Space': {
					if (!e.repeat) {
						// send immediately, otherwise tabbing out would slow down setInterval and cause late splits
						mouse();
						net.split();
					}
					break;
				}
				case 'Enter': {
					ui.chat.input.focus();
					break;
				}
				case 'Escape': {
					ui.toggleEscOverlay();
					break;
				}
			}

			if (e.ctrlKey && e.code === 'KeyW') {
				// prevent ctrl+w (only when in fullscreen!) - helps when multiboxing
				e.preventDefault();
			} else if (e.ctrlKey && e.code === 'Tab') {
				e.returnValue = true; // undo e.preventDefault() by SigMod
				e.stopImmediatePropagation(); // prevent SigMod from calling e.preventDefault() afterwards
			} else if (e.code === 'Tab') {
				// prevent tabbing to a UI element, which then lets you press ctrl+w
				e.preventDefault();
			}
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
			const showClanmatesElement = document.querySelector('input#showClanmates');

			let clan;
			let sub = false;
			let token;
			if (aux.userData) {
				clan = aux.userData.clan;
				sub = (aux.userData.subscription ?? 0) > Date.now();
				token = aux.userData.token;
			}

			return {
				state: spectating ? 2 : undefined,
				name: nickElement?.value ?? '',
				skin: aux.settings?.skin,
				token,
				sub,
				clan,
				showClanmates: !showClanmatesElement || showClanmatesElement.checked,
			}
		}

		/** @type {HTMLButtonElement | null} */
		const play = document.querySelector('button#play-btn');
		/** @type {HTMLButtonElement | null} */
		const spectate = document.querySelector('button#spectate-btn');
		if (!play || !spectate) throw new Error('Can\'t find play or spectate button');
		play.disabled = spectate.disabled = true;

		(async () => {
			let grecaptcha, CAPTCHA2;
			do {
				grecaptcha = /** @type {any} */ (window).grecaptcha;
				CAPTCHA2 = /** @type {any} */ (window).CAPTCHA2;

				await aux.wait(50);
			} while (!(grecaptcha && CAPTCHA2 && grecaptcha.render && grecaptcha.reset));

			const container = document.createElement('div');
			container.id = 'g-recaptcha2';
			play.parentNode?.insertBefore(container, play);

			let handle;
			/** @type {string | undefined} */
			let v2;
			let v2Pending = false;
			/** @type {Symbol | undefined} */
			let v2LastConnection = undefined;
			const getV2 = function getV2() {
				if (v2Pending) return;
				v2Pending = true;

				if (handle !== undefined) {
					container.style.display = 'block';
					grecaptcha.reset(handle);
				} else {
					handle = grecaptcha.render('g-recaptcha2', {
						sitekey: CAPTCHA2,
						/** @param {string} token */
						callback: token => {
							v2 = token;
							v2Pending = false;
							container.style.display = 'none';
						}
					});
				}
			}
			getV2();

			setInterval(() => {
				const con = net.connection();
				if (v2 && con && v2LastConnection !== con) {
					net.captcha(v2, undefined);
					v2 = undefined;
					v2LastConnection = con;
				}

				if (!v2 && !v2Pending && v2LastConnection !== net.connection())
					getV2();

				play.disabled = spectate.disabled = v2LastConnection !== net.connection() || v2Pending;
			}, 100);

			/** @param {MouseEvent} e */
			async function clickHandler(e) {
				if (v2LastConnection !== net.connection() || v2Pending) return;
				ui.toggleEscOverlay(false);
				net.play(playData(e.currentTarget === spectate));
			}

			play.addEventListener('click', clickHandler);
			spectate.addEventListener('click', clickHandler);
		})();

		return input;
	})();



	//////////////////////////////
	// Configure WebGL Programs //
	//////////////////////////////
	const { programs, uniforms } = (() => {
		// #1 : init webgl context, define helper functions
		const gl = ui.game.gl;
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		/**
		 * @param {string} name
		 * @param {WebGLShader} vShader
		 * @param {WebGLShader} fShader
		 */
		function program(name, vShader, fShader) {
			const p = gl.createProgram();
			if (!p)
				throw new Error('GL program is null'); // highly doubt will ever happen in practice

			gl.attachShader(p, vShader);
			gl.attachShader(p, fShader);
			gl.linkProgram(p);

			// note: linking errors should not happen in production
			if (!gl.getProgramParameter(p, gl.LINK_STATUS))
				throw new Error(`failed to link program ${name}:\n${gl.getProgramInfoLog(p)}`);

			return p;
		}

		/**
		 * @param {string} name
		 * @param {number} type
		 * @param {string} source
		 */
		function shader(name, type, source) {
			const s = gl.createShader(type);
			if (!s)
				throw new Error('GL shader is null'); // highly doubt will ever happen in practice

			gl.shaderSource(s, source);
			gl.compileShader(s);

			// note: compilation errors should not happen in production
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
				throw new Error(`failed to compile shader ${name}:\n${gl.getShaderInfoLog(s)}`);

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
				const loc = gl.getUniformLocation(program, name);
				if (!loc)
					throw new Error(`uniform ${name} in ${programName} not found`);

				uniforms[name] = loc;
			});

			return /** @type {any} */ (uniforms);
		}



		// #2 : create programs
		const programs = {};
		const uniforms = {};

		programs.bg = program(
			'bg',
			shader('bg.vShader', gl.VERTEX_SHADER, `#version 300 es
			layout(location = 0) in vec2 a_pos;

			uniform float u_aspect_ratio;
			uniform vec2 u_camera_pos;
			uniform float u_camera_scale;

			out vec2 v_world_pos;

			void main() {
				gl_Position = vec4(a_pos, 0, 1);

				v_world_pos = a_pos * vec2(u_aspect_ratio, 1.0) / u_camera_scale;
				v_world_pos += u_camera_pos * vec2(1.0, -1.0);
			}
			`),
			shader('bg.fShader', gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			in vec2 v_world_pos;

			uniform float u_camera_scale;

			uniform vec4 u_border_color;
			uniform float[4] u_border_lrtb;
			uniform bool u_dark_theme_enabled;
			uniform bool u_grid_enabled;
			uniform sampler2D u_texture;

			out vec4 out_color;

			void main() {
				if (u_grid_enabled) {
					vec2 t_coord = v_world_pos / 50.0;
					out_color = texture(u_texture, t_coord);
					// fade grid pixels so when they become <1px wide, they're invisible
					float alpha = clamp(u_camera_scale * 540.0 * 50.0, 0.0, 1.0) * 0.1;
					if (u_dark_theme_enabled) {
						out_color *= vec4(1, 1, 1, alpha);
					} else {
						out_color *= vec4(0, 0, 0, alpha);
					}
				}

				// force border to always be visible, otherwise it flickers
				float thickness = max(3.0 / (u_camera_scale * 540.0), 25.0);

				// make a larger inner rectangle and a normal inverted outer rectangle
				float inner_alpha = min(
					min((v_world_pos.x + thickness) - u_border_lrtb[0], u_border_lrtb[1] - (v_world_pos.x - thickness)),
					min((v_world_pos.y + thickness) - u_border_lrtb[2], u_border_lrtb[3] - (v_world_pos.y - thickness))
				);
				float outer_alpha = max(
					max(u_border_lrtb[0] - v_world_pos.x, v_world_pos.x - u_border_lrtb[1]),
					max(u_border_lrtb[2] - v_world_pos.y, v_world_pos.y - u_border_lrtb[3])
				);
				float alpha = clamp(min(inner_alpha, outer_alpha), 0.0, 1.0);

				out_color = out_color * (1.0 - alpha) + u_border_color * alpha;
			}
			`),
		);
		uniforms.bg = getUniforms('bg', programs.bg, [
			'u_aspect_ratio', 'u_camera_pos', 'u_camera_scale',
			'u_border_color', 'u_border_lrtb', 'u_dark_theme_enabled', 'u_grid_enabled',
		]);



		programs.cell = program(
			'cell',
			shader('cell.vShader', gl.VERTEX_SHADER, `#version 300 es
			layout(location = 0) in vec2 a_pos;

			uniform float u_aspect_ratio;
			uniform vec2 u_camera_pos;
			uniform float u_camera_scale;

			uniform float u_inner_radius;
			uniform float u_outer_radius;
			uniform vec2 u_pos;

			out vec2 v_pos;
			out vec2 v_t_coord;

			void main() {
				v_pos = a_pos;
				v_t_coord = a_pos / (u_inner_radius / u_outer_radius) * 0.5 + 0.5;

				vec2 clip_pos = -u_camera_pos + u_pos + a_pos * u_outer_radius;
				clip_pos *= u_camera_scale * vec2(1.0 / u_aspect_ratio, -1.0);
				gl_Position = vec4(clip_pos, 0, 1);
			}
			`),
			shader('cell.fShader', gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			in vec2 v_pos;
			in vec2 v_t_coord;

			uniform float u_camera_scale;

			uniform float u_alpha;
			uniform vec4 u_color;
			uniform float u_outer_radius;
			uniform vec4 u_outline_color;
			uniform bool u_outline_thick;
			uniform sampler2D u_texture;
			uniform bool u_texture_enabled;

			out vec4 out_color;

			void main() {
				float blur = 0.5 * u_outer_radius * (540.0 * u_camera_scale);
				float d2 = v_pos.x * v_pos.x + v_pos.y * v_pos.y;
				float a = clamp(-blur * (d2 - 1.0), 0.0, 1.0);

				if (u_texture_enabled) {
					out_color = texture(u_texture, v_t_coord);
				}
				out_color = vec4(out_color.rgb, 1) * out_color.a + u_color * (1.0 - out_color.a);

				// outline
				// d > 0.98   => d2 > 0.9604 (default)
				// d > 0.96   => d2 > 0.9216 (thick)
				float outline_d = u_outline_thick ? 0.9216 : 0.9604;
				float oa = clamp(blur * (d2 - outline_d), 0.0, 1.0);
				out_color = out_color * (1.0 - oa) + u_outline_color * oa;

				out_color.a *= a * u_alpha;
			}
			`),
		);
		uniforms.cell = getUniforms('cell', programs.cell, [
			'u_aspect_ratio', 'u_camera_pos', 'u_camera_scale',
			'u_alpha', 'u_color', 'u_outline_color', 'u_outline_thick', 'u_inner_radius', 'u_outer_radius', 'u_pos',
			'u_texture_enabled',
		]);



		programs.text = program(
			'text',
			shader('text.vShader', gl.VERTEX_SHADER, `#version 300 es
			layout(location = 0) in vec2 a_pos;

			uniform float u_aspect_ratio;
			uniform vec2 u_camera_pos;
			uniform float u_camera_scale;

			uniform vec2 u_pos;
			uniform float u_radius;
			uniform bool u_subtext_enabled;
			uniform float u_text_aspect_ratio;

			out vec2 v_pos;

			void main() {
				v_pos = a_pos;

				vec2 clip_space;
				if (u_subtext_enabled) {
					clip_space = a_pos * 0.5 + vec2(0, 0.5);
				} else {
					clip_space = a_pos + vec2(0, -0.25);
				}

				clip_space *= u_radius * 0.3 * vec2(u_text_aspect_ratio, 1.0);
				clip_space += -u_camera_pos + u_pos;
				clip_space *= u_camera_scale * vec2(1.0 / u_aspect_ratio, -1.0);
				gl_Position = vec4(clip_space, 0, 1);
			}
			`),
			shader('text.fShader', gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			in vec2 v_pos;

			uniform float u_alpha;
			uniform vec3 u_color1;
			uniform vec3 u_color2;
			uniform bool u_silhouette_enabled;

			uniform sampler2D u_texture;
			uniform sampler2D u_silhouette;

			out vec4 out_color;

			void main() {
				vec2 t_coord = v_pos * 0.5 + 0.5;

				float c2_alpha = (t_coord.x + t_coord.y) / 2.0;
				vec4 color = vec4(u_color1 * (1.0 - c2_alpha) + u_color2 * c2_alpha, 1);
				vec4 normal = texture(u_texture, t_coord);

				if (u_silhouette_enabled) {
					vec4 silhouette = texture(u_silhouette, t_coord);

					// #fff - #000 => color (text)
					// #fff - #fff => #fff (respect emoji)
					// #888 - #888 => #888 (respect emoji)
					// #fff - #888 => #888 + color/2 (blur/antialias)
					out_color = silhouette + (normal - silhouette) * color;
				} else {
					out_color = normal * color;
				}

				out_color.a *= u_alpha;
			}
			`),
		);
		uniforms.text = getUniforms('text', programs.text, [
			'u_aspect_ratio', 'u_camera_pos', 'u_camera_scale',
			'u_alpha', 'u_color1', 'u_color2', 'u_pos', 'u_radius', 'u_silhouette', 'u_silhouette_enabled',
			'u_subtext_enabled', 'u_text_aspect_ratio', 'u_texture',
		]);



		return { programs, uniforms };
	})();



	///////////////////////////////
	// Define Rendering Routines //
	///////////////////////////////
	(() => {
		const gl = ui.game.gl;

		// #1 : define small misc objects
		const square = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, square);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		const gridSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IArs4c6QAAAKVJREFUaEPtkkEKwlAUxBzw/jeWL4J4gECkSrqftC/pzjnn9gfP3ofcf/mWbY8OuVLBilypxutbKlIRyUC/liQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNKyIJBZjK4LVScOKSGIxtiJYnTSsiCQWYyuC1UnDikhiMbYiWJ00rIgkFmMrgtVJw4pIYjG2IlidNPwU2TbpHV/DPgFxJfgvliP9RQAAAABJRU5ErkJggg==';
		const virusSrc = '/assets/images/viruses/2.png';



		// #2 : define helper functions
		const textureFromCache = (() => {
			/** @type {Map<string, WebGLTexture | null>} */
			const cache = new Map();

			/**
			 * @param {string} src
			 */
			return src => {
				const cached = cache.get(src);
				if (cached !== undefined)
					return cached ?? undefined;

				cache.set(src, null);

				const image = new Image();
				image.addEventListener('load', () => {
					const texture = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
					gl.generateMipmap(gl.TEXTURE_2D);
					cache.set(src, texture);
				});
				image.src = src;

				return undefined;
			};
		})();

		const textFromCache = (() => {
			/**
			 * @template {boolean} T
			 * @typedef {{ aspectRatio: number, text: WebGLTexture,
				silhouette: T extends true ? WebGLTexture : WebGLTexture | undefined,
			  accessed: number }} CacheEntry
			 */
			/** @type {Map<string, CacheEntry<boolean>>} */
			const cache = new Map();

			setInterval(() => {
				// remove text after not being used for 10 minutes
				const now = performance.now();
				cache.forEach((entry, text) => {
					if (entry.accessed - now > 600_000) {
						// immediately delete text instead of waiting for GC
						gl.deleteTexture(entry.text);
						if (entry.silhouette) gl.deleteTexture(entry.silhouette);
						cache.delete(text);
					}
				});
			}, 60_000);

			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (!ctx) throw new Error('canvas.getContext(\'2d\') yields null, for whatever reason');
			const textSize = 72;

			// declare a little awkwardly, after ctx is definitely not null
			/**
			 * @param {string} text
			 * @param {boolean} silhouette
			 */
			const texture = function texture(text, silhouette) {
				const lineWidth = Math.ceil(textSize / 10);

				ctx.font = textSize + 'px Ubuntu';
				canvas.width = ctx.measureText(text).width + lineWidth * 2;
				ctx.clearRect(0, 0, canvas.width, canvas.height);

				// setting canvas.width resets the canvas state
				ctx.font = textSize + 'px Ubuntu';
				ctx.lineWidth = lineWidth;
				ctx.fillStyle = silhouette ? '#000' : '#fff';
				ctx.strokeStyle = '#000';

				ctx.strokeText(text, lineWidth, textSize * 1.5);
				ctx.fillText(text, lineWidth, textSize * 1.5);

				const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

				const texture = gl.createTexture();
				if (!texture) throw new Error('gl.createTexture() yields null');
				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
				gl.generateMipmap(gl.TEXTURE_2D);
				return texture;
			};

			/**
			 * @template {boolean} T
			 * @param {string} text
			 * @param {T} silhouette
			 * @returns {CacheEntry<T>}
			 */
			return (text, silhouette) => {
				let entry = cache.get(text);
				if (!entry) {
					entry = {
						text: texture(text, false),
						aspectRatio: canvas.width / canvas.height, // mind the execution order
						silhouette: silhouette ? texture(text, true) : undefined,
						accessed: performance.now(),
					};
					cache.set(text, entry);
				} else {
					entry.accessed = performance.now();
				}

				if (silhouette && !entry.silhouette) {
					entry.silhouette = texture(text, true);
				}

				return entry;
			};
		})();



		// #3 : define the render function
		let fps = 0;
		let lastFrame = performance.now();
		function render() {
			const now = performance.now();
			const dt = (now - lastFrame) / 1000;
			fps += (1 / dt - fps) / 10;
			lastFrame = now;

			// note: most routines are named, for benchmarking purposes
			(function setGlobalUniforms() {
				const aspectRatio = ui.game.canvas.width / ui.game.canvas.height;
				const cameraPosX = world.camera.x;
				const cameraPosY = world.camera.y;
				const cameraScale = world.camera.scale / 540; // (height of 1920x1080 / 2 = 540)

				gl.useProgram(programs.bg);
				gl.uniform1f(uniforms.bg.u_aspect_ratio, aspectRatio);
				gl.uniform2f(uniforms.bg.u_camera_pos, cameraPosX, cameraPosY);
				gl.uniform1f(uniforms.bg.u_camera_scale, cameraScale);

				gl.useProgram(programs.cell);
				gl.uniform1f(uniforms.cell.u_aspect_ratio, aspectRatio);
				gl.uniform2f(uniforms.cell.u_camera_pos, cameraPosX, cameraPosY);
				gl.uniform1f(uniforms.cell.u_camera_scale, cameraScale);

				gl.useProgram(programs.text);
				gl.uniform1f(uniforms.text.u_aspect_ratio, aspectRatio);
				gl.uniform2f(uniforms.text.u_camera_pos, cameraPosX, cameraPosY);
				gl.uniform1f(uniforms.text.u_camera_scale, cameraScale);
				gl.uniform1i(uniforms.text.u_texture, 0);
				gl.uniform1i(uniforms.text.u_silhouette, 1);
			})();

			/** @type {HTMLInputElement | null} */
			const darkTheme = document.querySelector('input#darkTheme');

			(function background() {
				/** @type {HTMLInputElement | null} */
				const showBorder = document.querySelector('input#showBorder');
				/** @type {HTMLInputElement | null} */
				const showGrid = document.querySelector('input#showGrid');

				if (!darkTheme || darkTheme.checked) {
					gl.clearColor(0x11 / 255, 0x11 / 255, 0x11 / 255, 1); // #111
				} else {
					gl.clearColor(0xf2 / 255, 0xfb / 255, 0xff / 255, 1); // #f2fbff
				}
				gl.clear(gl.COLOR_BUFFER_BIT);

				const gridTexture = textureFromCache(gridSrc);
				if (!gridTexture) return;
				gl.bindTexture(gl.TEXTURE_2D, gridTexture);

				gl.useProgram(programs.bg);

				if (showBorder?.checked && world.border) {
					gl.uniform4f(uniforms.bg.u_border_color, 0, 0, 1, 1); // #00f
					gl.uniform1fv(uniforms.bg.u_border_lrtb,
						new Float32Array([ world.border.l, world.border.r, world.border.t, world.border.b ]));
				} else {
					gl.uniform4f(uniforms.bg.u_border_color, 0, 0, 0, 0); // transparent
					gl.uniform1fv(uniforms.bg.u_border_lrtb, new Float32Array([ 0, 0, 0, 0 ]));
				}

				gl.uniform1i(uniforms.bg.u_dark_theme_enabled, Number(!darkTheme || darkTheme.checked));
				gl.uniform1i(uniforms.bg.u_grid_enabled, Number(!showGrid || showGrid.checked));

				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			})();

			(function updateCells() {
				world.cells.forEach(cell => world.move(cell, now, dt));
			})();

			(function moveCamera() {
				let avgX = 0;
				let avgY = 0;
				let totalR = 0;
				let totalCells = 0;

				world.mine.forEach(id => {
					const cell = world.cells.get(id);
					if (!cell || cell.dead) return;

					avgX += cell.x;
					avgY += cell.y;
					totalR += cell.r;
					++totalCells;
				});

				avgX /= totalCells;
				avgY /= totalCells;

				let xyEaseFactor;
				if (totalCells > 0) {
					world.camera.tx = avgX;
					world.camera.ty = avgY;
					world.camera.tscale = Math.min(64 / totalR) ** 0.4 * input.zoom;

					xyEaseFactor = 2;
				} else {
					xyEaseFactor = 20;
				}

				world.camera.x = aux.exponentialEase(world.camera.x, world.camera.tx, xyEaseFactor, dt);
				world.camera.y = aux.exponentialEase(world.camera.y, world.camera.ty, xyEaseFactor, dt);
				world.camera.scale = aux.exponentialEase(world.camera.scale, world.camera.tscale, 9, dt);
			})();

			/** @type {HTMLInputElement | null} */
			const jellyPhysicsElement = document.querySelector('input#jellyPhysics');
			const jellyPhysics = jellyPhysicsElement?.checked;

			/** @type {HTMLInputElement | null} */
			const showNamesElement = document.querySelector('input#showNames');
			const showNames = !showNamesElement || showNamesElement.checked;

			(function cells() {
				const showMass = (/** @type {HTMLInputElement | null} */ (document.querySelector('input#showMass')))?.checked;

				/** @param {Cell} cell */
				function calcAlpha(cell) {
					let alpha = Math.min((now - cell.born) / 120, 1);
					if (cell.dead)
						alpha = Math.min(alpha, Math.max(1 - (now - cell.dead.at) / 120, 0));

					return alpha;
				}

				// for white cell outlines
				let nextCellIdx = world.mine.length;
				const canSplit = world.mine.map(id => {
					const cell = world.cells.get(id);
					if (!cell) {
						--nextCellIdx;
						return false;
					}

					if (cell.nr < 128)
						return false;

					return nextCellIdx++ < 16;
				});

				/**
				 * @param {Cell} cell
				 * @param {number} alpha
				 */
				function drawCell(cell, alpha) {
					gl.useProgram(programs.cell);

					gl.uniform1f(uniforms.cell.u_alpha, alpha);

					if (jellyPhysics) {
						gl.uniform2f(uniforms.cell.u_pos, cell.jelly.x, cell.jelly.y);
						gl.uniform1f(uniforms.cell.u_inner_radius, cell.r);
						gl.uniform1f(uniforms.cell.u_outer_radius, cell.jelly.r);
					} else {
						gl.uniform2f(uniforms.cell.u_pos, cell.x, cell.y);
						gl.uniform1f(uniforms.cell.u_inner_radius, cell.r);
						gl.uniform1f(uniforms.cell.u_outer_radius, cell.r);
					}

					if (cell.jagged) {
						const virusTexture = textureFromCache(virusSrc);
						if (!virusTexture)
							return;

						gl.uniform4f(uniforms.cell.u_color, 0, 0, 0, 0);
						gl.uniform4f(uniforms.cell.u_outline_color, 0, 0, 0, 0);
						gl.uniform1i(uniforms.cell.u_outline_thick, 0);
						gl.uniform1i(uniforms.cell.u_texture_enabled, 1);
						gl.bindTexture(gl.TEXTURE_2D, virusTexture);

						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						return;
					}

					const myIndex = world.mine.indexOf(cell.id);
					gl.uniform4f(uniforms.cell.u_color, ...cell.rgb, 1);
					if (myIndex === -1 || canSplit[myIndex]) {
						gl.uniform4f(uniforms.cell.u_outline_color,
							cell.rgb[0] * 0.9, cell.rgb[1] * 0.9, cell.rgb[2] * 0.9, 1);
						gl.uniform1i(uniforms.cell.u_outline_thick, 0);
					} else {
						gl.uniform1i(uniforms.cell.u_outline_thick, 1);
						if (!darkTheme || darkTheme.checked)
							gl.uniform4f(uniforms.cell.u_outline_color, 1, 1, 1, 1);
						else
							gl.uniform4f(uniforms.cell.u_outline_color, 0, 0, 0, 1);
					}

					gl.uniform1i(uniforms.cell.u_texture_enabled, 0);
					if (cell.skin) {
						const texture = textureFromCache(cell.skin);
						if (texture) {
							gl.uniform1i(uniforms.cell.u_texture_enabled, 1);
							gl.bindTexture(gl.TEXTURE_2D, texture);
						}
					}

					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				}

				/**
				 * @param {Cell} cell
				 * @param {number} alpha
				 */
				function drawText(cell, alpha) {
					const showThisName = showNames && cell.r > 20 && cell.name;
					const showThisMass = showMass && cell.r > 75;
					if (!showThisName && !showThisMass) return;

					gl.useProgram(programs.text);

					gl.uniform1f(uniforms.text.u_alpha, alpha);
					if (jellyPhysics)
						gl.uniform2f(uniforms.text.u_pos, cell.jelly.x, cell.jelly.y);
					else
						gl.uniform2f(uniforms.text.u_pos, cell.x, cell.y);
					gl.uniform1f(uniforms.text.u_radius, cell.r);

					if (cell.sub) {
						gl.uniform3f(uniforms.text.u_color1, 0xeb / 255, 0x95 / 255, 0x00 / 255); // #eb9500
						gl.uniform3f(uniforms.text.u_color2, 0xe4 / 255, 0xb1 / 255, 0x10 / 255); // #e4b110
					} else {
						gl.uniform3f(uniforms.text.u_color1, 1, 1, 1);
						gl.uniform3f(uniforms.text.u_color2, 1, 1, 1);
					}

					if (showThisName) {
						const { aspectRatio, text, silhouette } = textFromCache(cell.name, cell.sub);
						gl.uniform1f(uniforms.text.u_text_aspect_ratio, aspectRatio);
						gl.uniform1i(uniforms.text.u_silhouette_enabled, silhouette ? 1 : 0);
						gl.uniform1i(uniforms.text.u_subtext_enabled, 0);

						gl.bindTexture(gl.TEXTURE_2D, text);
						if (silhouette) {
							gl.activeTexture(gl.TEXTURE1);
							gl.bindTexture(gl.TEXTURE_2D, silhouette);
							gl.activeTexture(gl.TEXTURE0);
						}

						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					}

					if (showThisMass) {
						// use nr (not interpolated), so we only get ~2500 unique mass texts (up to 62500 mass)
						// keep in mind cells go past 62500 for one frame before autosplitting, so not totally foolproof
						const mass = Math.floor(cell.nr * cell.nr / 100).toString();
						const { aspectRatio, text } = textFromCache(mass, false);
						gl.uniform1f(uniforms.text.u_text_aspect_ratio, aspectRatio);
						gl.uniform1i(uniforms.text.u_silhouette_enabled, 0);
						gl.uniform1i(uniforms.text.u_subtext_enabled, 1);

						gl.bindTexture(gl.TEXTURE_2D, text);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					}
				}

				/** @type {Cell[]} */
				const sorted = [];
				world.cells.forEach(cell => {
					if (cell.r > 20) {
						// not a pellet, will draw sorted later
						sorted.push(cell);
					}

					const alpha = calcAlpha(cell);
					drawCell(cell, alpha);
				});

				sorted.sort((a, b) => a.r - b.r);

				sorted.forEach(cell => {
					const alpha = calcAlpha(cell);
					drawCell(cell, alpha);
					if (!cell.jagged)
						drawText(cell, alpha);
				});
			})();

			(function updateStats() {
				ui.stats.matchTheme(); // not sure how to listen to when the checkbox changes when the game loads
				if (showNames && world.leaderboard.length > 0)
					ui.leaderboard.container.style.display = '';
				else
					ui.leaderboard.container.style.display = 'none';

				let score = 0;
				world.mine.forEach(id => {
					const cell = world.cells.get(id);
					if (!cell || cell.dead) return;

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

				if (world.mine.length === 0 && world.stats.spawnedAt !== undefined) {
					ui.deathScreen.show(world.stats);
				}
			})();

			(function minimap() {
				// text needs to be small and sharp, i don't trust webgl with that, so we use a 2d context
				const { border } = world;
				if (!border) return;

				/** @type {HTMLInputElement | null} */
				const showMinimap = document.querySelector('input#showMinimap');
				if (showMinimap && !showMinimap.checked) {
					ui.minimap.canvas.style.display = 'none';
					return;
				} else {
					ui.minimap.canvas.style.display = '';
				}

				const { canvas, ctx } = ui.minimap;
				canvas.width = canvas.height = 200 * devicePixelRatio;
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
				ctx.fillStyle = (!darkTheme || darkTheme.checked) ? '#fff' : '#000';
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
					const x = (cell.x - border.l) / gameWidth * canvas.width;
					const y = (cell.y - border.t) / gameHeight * canvas.height;
					const r = Math.max(cell.r / gameWidth * canvas.width, 2);

					ctx.fillStyle = aux.rgb2hex(cell.rgb);
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
					ctx.fillText(name, x, y - 7 * devicePixelRatio - sectorSize / 6);
				}

				// draw clanmates first, below yourself
				// we sort clanmates by color AND name, to ensure clanmates stay separate
				/** @type {Map<string, { name: string, n: number, x: number, y: number }>} */
				const avgPos = new Map();
				world.clanmates.forEach(cell => {
					if (world.mine.includes(cell.id)) return;
					drawCell(cell);

					const id = cell.name + (cell.rgb[0] + 255*cell.rgb[1] + 255*255*cell.rgb[2]);
					const entry = avgPos.get(id);
					if (entry) {
						++entry.n;
						entry.x += cell.x;
						entry.y += cell.y;
					} else {
						avgPos.set(id, { name: cell.name, n: 1, x: cell.x, y: cell.y });
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
					myName = cell.name;
					++ownN;
					ownX += cell.x;
					ownY += cell.y;
				});

				if (ownN <= 0) {
					// if no cells were drawn, draw our spectate pos instead
					const x = (world.camera.x - border.l) / gameWidth * canvas.width;
					const y = (world.camera.y - border.t) / gameHeight * canvas.height;

					ctx.fillStyle = '#faa';
					ctx.beginPath();
					ctx.moveTo(x + 5, y);
					ctx.arc(x, y, 5, 0, 2 * Math.PI);
					ctx.fill();
				} else {
					// draw name above player's cells
					drawName(ownX / ownN, ownY / ownN, myName);
				}
			})();

			ui.chat.matchTheme();

			requestAnimationFrame(render);
		}

		requestAnimationFrame(render);
	})();



	// for me and other script developers! i'll try not to change things around too much,
	// but do some null?.coalescing?.just?.in?.case
	// @ts-expect-error
	window.sigfix = { destructor, aux, ui, world, net, version: 2 };
})();
