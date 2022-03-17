
import { interval, fromEvent, from, zip, Subject, bindCallback } from 'rxjs'
import { FromEventTarget } from 'rxjs/internal/observable/fromEvent'
import { map, scan, filter, merge, flatMap, take, concat, takeUntil, repeatWhen } from 'rxjs/operators'

type Key = 'ArrowUp' | 'ArrowDown'
type Event = 'keydown' | 'keyup' | 'click'

const
	// frequently used constants or constants of import that lent themselves to having their own declaration
	Constants = new class {
		readonly CanvasSize = 600;
		readonly BallRadius = 7;
		readonly BarHeight = 75;
		readonly BarWidth = 6;
		readonly Zero = 0;
		readonly InitalBallVelocity = 1;
		readonly maxBounceAngle = 500;
		readonly maxScore = 7;
		readonly playerBarNum = 1;
		readonly computerBarNum = 2;
		readonly opacityReduction = 0.25
	}

// handles all things vectors, always returning a new object in order to ensure purity
class Vector {
	constructor(public readonly x: number = 0, public readonly y: number = 0) { }
	add = (v: Vector) => new Vector(this.x + v.x, this.y + v.y)
	private scale = (s: number) => new Vector(this.x * s, this.y * s)
	flipY = () => new Vector(this.x, -this.y)
	flipX = () => new Vector(-this.x, this.y)
	alterY = (y: number) => new Vector(this.x, y)
	static Zero = new Vector();
}

// depending on where the ball bounces on the bar the velocity vector is of different speeds (and flipped)
const calcBouncedVelocity = (currVec: Vector, incomingPos: number) =>
	new Vector(-currVec.x, (Constants.maxBounceAngle * -(incomingPos + Constants.BarHeight / 2) / (Constants.BarHeight / 2) / 100));


// takes an key event for which it results in a movement (specified by the stub Slide class) 
const keyObservable = <T>(event: Event, key: Key, movementResult: () => T) =>
	fromEvent<KeyboardEvent>(document, event)
		.pipe(filter(({ code }) => code === key),
			map(movementResult))

// (generic types: parametric polymorphism)
const mouseObservable = <MouseEvent, T>(documentElem: FromEventTarget<MouseEvent>, event: Event, movementResult: () => T) =>
	fromEvent<MouseEvent>(documentElem, event).pipe(map(movementResult))

// This type is for objects on the canvas that move
type NewtonianBody = Readonly<{
	position: Vector,
	acceleration?: Vector,
	velocity: Vector,
	// For paddles this is the height, for ball this is the radius
	size: number
}>

// Bodies specific to Breakout
type BrickBody = Readonly<{
	id: number,
	position: Vector,
	width: number,
	height: number,
	opacity: number,
	numberOfHitsLeft: number
}>

// a type that is used in all instances of a state, representing the characteristics of all objects (and other necessary items for gameplay) for a given state
type State = Readonly<{
	time: number,
	playerBar: NewtonianBody,
	computerBar: NewtonianBody,
	ball: NewtonianBody,
	p1Score: number,
	p2Score: number,
	endOfGame: number,
	computerDifficulty: number,
	// below is for the extra game feature that is similar to breakout
	isBreakout: boolean,
	breakoutAddedEffects: HTMLAudioElement,
	bricks: ReadonlyArray<BrickBody>
	// contains element id
	bricksToRemove: ReadonlyArray<number>

}>

function pong() {
	// stub classes used for holding a basic attribute of, for instance, a Tick
	class Tick { constructor(public readonly elapsed: number) { } }
	class Slide { constructor(public readonly direction: number) { } }
	// below 3 are for the button/range inputs of the user
	class Restart { constructor(public readonly isRestart: boolean) { } }
	class SetDifficulty { constructor(public readonly difficVal: number) { } }
	class ToggleBreakout { constructor(public readonly isBreak: boolean) { } }

	// Key event calls (to be used later on in the subscribe call)
	const
		startDownSlideStream = keyObservable(<Event>'keydown', <Key>'ArrowUp', () => new Slide(-8)),
		startUpSlideStream = keyObservable(<Event>'keydown', <Key>'ArrowDown', () => new Slide(8)),
		// below 3 are for the button/range inputs of the user
		// there is a restart observable for restarting while the game is playing and then another for when the subscription has been unsubscribed from.
		restartGameButtonStream = mouseObservable(document.getElementById("restartGameButton")! as HTMLInputElement, <Event>'click', () => new Restart(true)),
		// below 2 listen on any click on the page as it ensures most up to date value even across subscription reinstantiations
		difficultySliderStream = mouseObservable(document, <Event>'click', () =>
			new SetDifficulty(parseInt((document.getElementById("difficultyRange")! as HTMLInputElement).value))),
		// Since we want the breakout toggle button to work even when the game is not subscribed, it's state is managed in the html using js/jQuery
		// When the ToggleBreakout event occurs we capture the current value of the button's 'value' attribute. 
		// (listened to on any click event because we want the State to be always privvy to the most up to date HTML breakOutButton value - same goes for the difficultySliderStream)
		breakoutButtonStream = mouseObservable(document, <Event>'click', () =>
			new ToggleBreakout((document.getElementById("breakOutButton") as HTMLInputElement).className == 'active'))


	const createBar = (
		p: number,
		pos: Vector = new Vector(p === 1 ? Constants.CanvasSize / 8 : p === 2 ? 7 * Constants.CanvasSize / 8 : 0, Constants.CanvasSize / 2 - Constants.BarHeight / 2),
		acc: Vector = Vector.Zero, // legacy
		height: number = Constants.BarHeight
	) => <NewtonianBody>{
		position: pos,
		acceleration: acc,
		size: height
	};

	const createBall = (
		pos: Vector = new Vector(Constants.CanvasSize / 2, Constants.CanvasSize / 2),
		acc: Vector = Vector.Zero, // legacy
		vel: Vector = new Vector(Math.random() > 0.5 ? 3 : -3, Constants.Zero), // ball travels in random x direction (impure because seed could vary, but who likes predictable determinism anyway :)
		radius: number = Constants.BallRadius
	) => <NewtonianBody>{
		position: pos,
		acceleration: acc,
		velocity: vel,
		size: radius
	};

	// for breakout
	const createBrick = (wid: number, h: number, opac: number, numHitLeft: number) => (i: number) => (pos: Vector) =>
		<BrickBody>{
			id: i,
			position: pos,
			width: wid,
			height: h,
			opacity: opac,
			numberOfHitsLeft: numHitLeft
		};

	// necessary for breakout mode
	const initialiseBricks = () => {
		const tempBrickHeight = 40,
			pixelsOffCenter = 20;
		// initialising bricks fundamental characteristics using a higher order function
		const defaultBrick = createBrick(7, tempBrickHeight - 2, 1, 4) // setting basic features of default brick
		return new Array(Constants.CanvasSize / tempBrickHeight).fill(defaultBrick) // setting brick id and placement relative to the canvas
			.map((item, index) => item(index + 1)(new Vector(Constants.CanvasSize / 2 + (index % 2 == 0 ? + pixelsOffCenter : -pixelsOffCenter), index * tempBrickHeight)))
	}

	// the starting value for the scan (used later on)
	const initialState: State = {
		time: 0,
		playerBar: createBar(Constants.playerBarNum),
		computerBar: createBar(Constants.computerBarNum),
		ball: createBall(),
		p1Score: 0,
		p2Score: 0,
		endOfGame: 0,
		isBreakout: false,
		breakoutAddedEffects: new Audio('musc/SpecialRequest-SpectralFrequency.mp3'), // music thanks to Special Request
		computerDifficulty: 25 / 20, // y velocity the bar travels at
		// chose to intialise bricks at the start of the game because it's such an inexpensive action
		bricks: initialiseBricks(),
		bricksToRemove: []
	}

	// two 'mutator' methods (retaining purity though!) that instantiate a new object/number (used in order to have more terse code later on)
	const incrementScore = (score: number, hasWonPoint: boolean) => score + (hasWonPoint ? 1 : 0)
	const calculateBallBounce = (ball: NewtonianBody, isballBounceOnBorder: boolean, isballBounceOnPaddle: boolean, paddleAimVerticalError: number, isBallBounceOnBrick: boolean = false) =>
		<NewtonianBody>{
			...ball,
			velocity:
				isballBounceOnPaddle
					? calcBouncedVelocity(ball.velocity, paddleAimVerticalError)
					: isballBounceOnBorder ? ball.velocity.flipY()
					: isBallBounceOnBrick ? ball.velocity.flipX().flipY() // brick bounce has a special motion (returns at the exact same angle it came in at)
					: ball.velocity
		}
	const moveObject = (o: NewtonianBody) => <NewtonianBody>{
		...o,
		position: o.position.add(o.velocity)
	}

	const objInteractionHandling = (s: State) => {
		// Design note: This method is a fair bit larger than what is prefered but that's because it contains large boolean variables. 
		// But all like interactions are done within this method hence why it would be awkward to separate these items further
		// this function just about looks after all objects interactions (inclusive of score)
		const
			//extracting some frequently used variables
			ballPos = s.ball.position,
			compBarPos = s.computerBar.position,
			playBarPos = s.playerBar.position,

			isballp1Endzone = ballPos.x <= Constants.Zero,
			isballp2Endzone = ballPos.x >= Constants.CanvasSize,
			newP1Score = incrementScore(s.p1Score, isballp2Endzone),
			newP2Score = incrementScore(s.p2Score, isballp1Endzone),

			// handling of ball collision with significant borders
			isballBounceOnLeftBar = (ballPos.x - s.ball.size - Constants.BarWidth <= Constants.CanvasSize / 8 && ballPos.x >= Constants.CanvasSize / 8 - 10
				&& (ballPos.y >= playBarPos.y
					&& ballPos.y <= playBarPos.y + Constants.BarHeight)),
			isballBounceOnRightBar = (ballPos.x + s.ball.size >= 7 * Constants.CanvasSize / 8 && ballPos.x <= 7 * Constants.CanvasSize / 8 + 10
				&& (ballPos.y >= compBarPos.y
					&& ballPos.y <= compBarPos.y + Constants.BarHeight)),
			isballBounceOnBorder = ballPos.y <= Constants.Zero || ballPos.y >= Constants.CanvasSize,
			// gives a relative position of the ball to the paddle (anchored at the most upper point of the paddle)
			paddleAimVerticalError = isballBounceOnLeftBar ? playBarPos.y - ballPos.y :
				isballBounceOnRightBar ? compBarPos.y - ballPos.y :
					0,
			isBallBounceOnBrick = (b: BrickBody) => (b.position.x <= ballPos.x + s.ball.size && ballPos.x - s.ball.size <= b.position.x + b.width) &&
				(b.position.y <= ballPos.y + s.ball.size && ballPos.y - s.ball.size <= b.position.y + b.height),
			setBrickOpacity = (b: BrickBody) => <BrickBody>{ ...b, opacity: b.opacity - Constants.opacityReduction, numberOfHitsLeft: b.numberOfHitsLeft - 1 },
			brickToRemove = (b: BrickBody) => !Boolean(b.numberOfHitsLeft),
			brickToKeep = (b: BrickBody) => b.numberOfHitsLeft > 0,
			getBrickID = (b: BrickBody) => b.id

		// general state ensuring no collisions with basic objects (independent of game mode)
		const mainState = <State>{
			...s,
			p1Score: newP1Score,
			p2Score: newP2Score,
			computerBar: Math.sign(s.ball.velocity.x) ? 
				<NewtonianBody>{
					...s.computerBar,
					position: s.computerBar.position.alterY(Math.sign(s.computerBar.position.y - ballPos.y + Constants.BarHeight / 2) === -1 ? // bar follows ball
						// s.computerDifficulty is with respect to the user defined game difficulty (the greater the difficulty the faster the computerBar moves)
						s.computerBar.position.y + s.computerDifficulty :
						s.computerBar.position.y - s.computerDifficulty)
				} :
				s.computerBar,
			// holding the number of the player who won
			endOfGame: newP1Score === Constants.maxScore ? Constants.playerBarNum :
				newP2Score === Constants.maxScore ? Constants.computerBarNum :
					0
		}

		const newBricksState = s.isBreakout ? s.bricks.map(x => isBallBounceOnBrick(x) ? setBrickOpacity(x) : x) : undefined;
		// decision tree of two states whether isBreakout or not
		return s.isBreakout ? <State>{
			...mainState,
			ball: isballp1Endzone || isballp2Endzone ?
				// restarting the ball to center position
				createBall() :
				// returns a vector at which the ball bounces at
				calculateBallBounce(s.ball,
					isballBounceOnBorder,
					isballBounceOnLeftBar || isballBounceOnRightBar,
					paddleAimVerticalError,
					s.bricks.map(isBallBounceOnBrick).includes(true)),
			bricks: s.bricks.map(isBallBounceOnBrick).includes(true) ? newBricksState.filter(brickToKeep) : s.bricks, // keeping brick that don't have numberOfHitsLeft = 0
			bricksToRemove: [...s.bricksToRemove, newBricksState.filter(brickToRemove).map(getBrickID)].flat() //bricks to remove from Canvas (by ID)
		}
			// non-breakout version state
			: <State>{
				...mainState,
				ball: isballp1Endzone || isballp2Endzone ?
					// restarting the ball to center position
					createBall() :
					// returns a vector at which the ball bounces at
					calculateBallBounce(s.ball, isballBounceOnBorder, isballBounceOnLeftBar || isballBounceOnRightBar, paddleAimVerticalError)
			}
	}
	const tick = (s: State, elapsed: number) =>
		objInteractionHandling(<State>{
			...s,
			time: elapsed,
			ball: moveObject(s.ball)
		})

	const thrower = (s:string) => { throw Error(s); }

	// used as a part of scan which is the accumulated current state
	const reduceState = (s: State, eve: Tick | Slide | ToggleBreakout | Restart | SetDifficulty) =>
	// updates state for all other interactions such as objects interacting with eachother, score and computer bar tracking pong ball
	eve instanceof Tick ?  
		tick(s, eve.elapsed) 
	: eve instanceof Slide ? 
		<State>{
			// when the user presses an arrow key we adjust the state
		...s,
		playerBar: <NewtonianBody>{
		...s.playerBar,
		// ensuring player bar is within the bounds of the canvas
		position: s.playerBar.position.add(new Vector(0, eve.direction)).y <= Constants.CanvasSize - Constants.BarHeight
			&& s.playerBar.position.add(new Vector(0, eve.direction)).y >= Constants.Zero ?
			s.playerBar.position.add(new Vector(0, eve.direction)) :
			s.playerBar.position
			}
		}
	: eve instanceof Restart ?
		// when the user presses the restart button we reinitialise state
		<State>initialState
	: eve instanceof ToggleBreakout ?
		// adjust the boolean value in the State (after the user has chosen the breakout mode)
		// Note - changing in and out of breakout mode does not reset the brick state.
		// During processing of the next Tick event, the new isBreak value takes effect.
		<State>{ ...s, isBreakout: eve.isBreak }
	: eve instanceof SetDifficulty ?
		// adjusting the computer bar speed in realtime (ignore the divide by 20 its arbitrary - but it stops the bar from tracking the ball too fast)
		<State>{ ...s, computerDifficulty: eve.difficVal / 20 }		
	: thrower("unrecognised event" + typeof eve);


	// HEART: this is where we subscribe to the actions of the game accepting the user inputs
	const sub = interval(10).pipe(
		map(elapsed => new Tick(elapsed)),
		merge(
			// bringing together user events that are passed into scan, then used in reduce state
			startDownSlideStream,
			startUpSlideStream,
			difficultySliderStream,
			restartGameButtonStream,
			breakoutButtonStream),
		scan(reduceState, initialState))
		.subscribe(updateView) // all HTML/SVG related manipulation is executed within the subscribe (this is where we have side-effects)


	function updateView(s: State) {
		// almost all the major side-effects are contained within this method (as per its necessity for RXJS to work)
		const
			canvas = document.getElementById("svg_background")!,
			setAttrib = (el: Element, obj: any) => { for (const k in obj) el!.setAttribute(k, String(obj[k])) },
			setInner = (el: Element, obj: any) => { el!.innerHTML = String(obj) };

		// Design note: all static (non-breakout version) objects are pre-created in the svg instead from TS code.
		// the reason for this was two fold, one most of the objects are static (not being dynamically placed)
		// second is that when the page is refreshed I was trying to avoid the objects jumping between two places (one set in HTML the other in TS) 
		// for the breakout version (with dynamic objects) attributes are set on the fly
		setInner(document.getElementById("playerScore1"), s.p1Score)
		setInner(document.getElementById("playerScore2"), s.p2Score)

		setAttrib(document.getElementById("playerBar1"), { x: s.playerBar.position.x, y: s.playerBar.position.y })
		setAttrib(document.getElementById("playerBar2"), { x: s.computerBar.position.x, y: s.computerBar.position.y })
		setAttrib(document.getElementById("ball"), { cx: s.ball.position.x, cy: s.ball.position.y })

		const updateBrickOnCanvas = (b: BrickBody) => {
			const setBrickAttrib = (br: Element) => setAttrib(br,
				{ id: b.id, x: b.position.x, y: b.position.y, opacity: b.opacity, height: b.height, width: b.width, fill: 'rgb(206,61,201)' })
			if (!document.getElementById(String(b.id))!) {
				const brick = document.createElementNS(canvas.namespaceURI, "rect")!
				setBrickAttrib(brick)
				canvas.appendChild(brick);
			}
			else {
				const brick = document.getElementById(String(b.id))
				setBrickAttrib(brick)
			}

		}
		const removeBrickOnCanvas = (b_id: number) => {
			const brick = document.getElementById(String(b_id))!
			if (brick != null) { canvas.removeChild(brick); }
		}

		// this is the setup logic for whenever the breakout toggle changes
		// Design note: we could, keep track of when we are switching game modes but it's simpler to just execute this setup logic every time (design choice because it doesn't cause a big performance hit)
		if (s.isBreakout) {
			// adding/removing breakout bricks
			canvas.setAttribute('style', 'background-color: rgb(153, 153, 0);')

			// setting all those fancy Breakout game aspects like the background, text and soundtrack
			s.breakoutAddedEffects.loop
			if (s.breakoutAddedEffects.paused){s.breakoutAddedEffects.play()}
			if (document.body.style.backgroundImage == "") { document.body.style.backgroundImage = "url('musc/space.gif')" } // gif thanks to https://tenor.com/view/flying-space-gif-13662982
			if (document.body.style.backgroundRepeat == "") { document.body.style.backgroundRepeat = 'no-repeat' }
			if (document.body.style.backgroundSize == "") { document.body.style.backgroundSize = '100% 100%' }
			// flipping the text colour to white
			Array.from(document.getElementsByClassName('navUText') as HTMLCollection).forEach(x => x.className = 'navUTextNeg')
		} else {
			// getting rid of bricks that have been hit the maximal number of times
			s.bricks.forEach(b => removeBrickOnCanvas(b.id))

			// removing all those fancy Breakout game aspects like the background, text and soundtrack
			Array.from(document.getElementsByClassName('navUTextNeg') as HTMLCollection).forEach(x => x.className = 'navUText')
			canvas.setAttribute('style', 'background-color: rgb(204, 204, 204);')
			if (!s.breakoutAddedEffects.paused){s.breakoutAddedEffects.pause()}
			document.body.style.backgroundSize = document.body.style.backgroundImage = document.body.style.backgroundRepeat = ''
		}

		// this is the continual update logic for Breakout
		if (s.isBreakout) {
			s.bricks.forEach(updateBrickOnCanvas)
			s.bricksToRemove.forEach(removeBrickOnCanvas)
		}

		if (s.endOfGame) {
			// ensuring music pauses at the end of the game
			if (!s.breakoutAddedEffects.paused){s.breakoutAddedEffects.pause()}
			// unsubscribing from the main game
			sub.unsubscribe()

			// background for end of the game
			const opaqBackground = document.createElementNS(canvas.namespaceURI, "rect")!;
			setAttrib(opaqBackground, {x: 0, y: 0, height: String(Constants.CanvasSize), width: String(Constants.CanvasSize), opacity: 0.65, fill: 'rgb(169,169,169)'})
			canvas.appendChild(opaqBackground)


			const endGameObj = document.createElementNS(canvas.namespaceURI, "text")!;
			setAttrib(endGameObj, { x: Constants.CanvasSize / 20, y: Constants.CanvasSize / 2, class: ("GameOverText") });
			endGameObj.textContent = "player " + String(s.endOfGame) + " is the winner winner chicken dinner!";
			canvas.appendChild(endGameObj);

			// after the unsubscribe if the game is restarted we need to remove the 'winner banner' and opaque background and 
			// restart the pong game ('take' is used for insurance, albeit superfluous (restart.unsubscribe() will do too by itself)
			// watching for a click on the restart button
			const restart = fromEvent<MouseEvent>(document.getElementById("restartGameButton")!, 'click').pipe(take(1)).subscribe(() => 
					{ canvas.removeChild(endGameObj);canvas.removeChild(opaqBackground); pong(); restart.unsubscribe() })

		}
	}
}

if (typeof window != 'undefined')
	window.onload = () => {

		// Highlights the user input under the 'controls' region of the game
		function highlightKey(keyToHightlight: Key) {
			const keyArrow = document.getElementById(keyToHightlight)!,
				obj = (eve: Event) => fromEvent<KeyboardEvent>(document, eve).pipe(filter(({ code }) => code === keyToHightlight))
			// adding the 'highlight' class when a keydown has been executed (removing on the keyup)
			obj(<Event>'keydown').subscribe(() => keyArrow.classList.add("highlight"))
			obj(<Event>'keyup').subscribe(() => keyArrow.classList.remove("highlight"))
		}
		highlightKey(<Key>'ArrowUp');
		highlightKey(<Key>'ArrowDown');

		pong();
	}



