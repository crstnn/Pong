import { interval, fromEvent, from, zip, Subject } from 'rxjs'
import { FromEventTarget } from 'rxjs/internal/observable/fromEvent'
import { map, scan, filter, merge, flatMap, take, concat, takeUntil, repeatWhen } from 'rxjs/operators'

type Key = 'ArrowUp' | 'ArrowDown'
type Event = 'keydown' | 'keyup'

const
	Constants = new class {
		readonly CanvasSize = 600;
		readonly StartTime = 0;
		readonly BallRadius = 7;
		readonly BarHeight = 75;
		readonly BarWidth = 6;
		readonly Zero = 0;
		readonly InitalBallVelocity = 1;
		readonly maxBounceAngle = 500;
		readonly maxScore = 7;
		readonly playerBarNum = 1;
		readonly computerBarNum = 2;
	}


const getComputerBarSpeed = () => parseInt((document.getElementById("difficultyRange")! as HTMLInputElement).value)/20;
const calcBouncedVelocity = (currVec: Vector, incomingPos: number) => 
	new Vector(-currVec.x, (Constants.maxBounceAngle * -(incomingPos+Constants.BarHeight/2) / (Constants.BarHeight/2)/100));

// handles all things vectors, always returning a new object in order to ensure purity
class Vector {
	constructor(public readonly x: number = 0, public readonly y: number = 0) {}
	add = (v: Vector) => new Vector(this.x + v.x, this.y + v.y)
	subtract = (v: Vector) => this.add(v.scale(-1))
	private scale = (s: number) => new Vector(this.x * s, this.y * s)
	flipY = () => new Vector(this.x, -this.y)
	flipX = () => new Vector(-this.x, this.y)
	alterY = (y: number) => new Vector(this.x, y)
	static Zero = new Vector();
}

// takes an key event for which it results in a movement (specifed by the stub Slide class)
const keyObservable = <T>(event: Event, key: Key, movementResult: () => T) =>
	fromEvent<KeyboardEvent>(document, event)
		.pipe(filter(({ code }) => code === key),
			map(movementResult))

const mouseObservable = <MouseEvent,T>(documentElem: FromEventTarget<MouseEvent>, event: string, movementResult: () => T) =>
	fromEvent<MouseEvent>(documentElem, event).pipe(map(movementResult))

// This type is for objects on the canvas that move
type NewtonianBody = Readonly<{
	position: Vector,
	// TODO add acceleration
	acceleration?: Vector,
	velocity: Vector,
	// For paddles this is the height, for ball this is the radius
	size: number
}>

type BrickBody = Readonly<{
	position: Vector,
	width: number,
	height: number,
	opacity: number,
	numberOfHits: number
}>

// a type that is used in all instances of a state, representing the state of all objects for a given state
type State = Readonly<{
	time: number,
	playerBar: NewtonianBody,
	computerBar: NewtonianBody,
	ball: NewtonianBody,
	p1Score: number,
	p2Score: number,
	endOfGame: number,
	// below is for the extra game feature that is similar to breakout
	isBreakout: boolean,
	bricks?: ReadonlyArray<NewtonianBody>

}>

function pong() {
	// stub classes used for holding a basic attribute of, for instance, a Tick
	class Tick { constructor(public readonly elapsed: number) { } }
	class Slide { constructor(public readonly direction: number) { } }

	// Key event calls (to be used later on in the subscribe call)
	const
		startDownSlide = keyObservable(<Event>'keydown', <Key>'ArrowUp', () => new Slide(-10)),
		startUpSlide = keyObservable(<Event>'keydown', <Key>'ArrowDown', () => new Slide(10)),
		stopUpSlide = keyObservable(<Event>'keyup', <Key>'ArrowUp', () => new Slide(0)),
		stopDownSlide = keyObservable(<Event>'keyup', <Key>'ArrowDown', () => new Slide(0)),
		restartClickButton = mouseObservable(document.getElementById("restartGameButton")!, 'click', () => new Subject<void>())


	const createBar = (
		p: number, 
		pos: Vector = new Vector(p === 1 ? Constants.CanvasSize / 8 : p === 2 ? 7 * Constants.CanvasSize / 8 : 0, Constants.CanvasSize / 2 - Constants.BarHeight/2), 
		acc: Vector = Vector.Zero, 
		height: number = Constants.BarHeight
		) => <NewtonianBody>{
			position: pos,
			acceleration: acc,
			size: height
	};

	const createBall = (
		pos: Vector = new Vector(Constants.CanvasSize/2, Constants.CanvasSize/2),
		acc: Vector = Vector.Zero,
		vel: Vector = new Vector(Math.random() > 0.5 ? 3 : -3, Constants.Zero),
		radius: number = Constants.BallRadius
		) => <NewtonianBody>{
			position: pos,
			acceleration: acc,
			velocity: vel,
			size: radius
	};

	const createBrick = (
		pos: Vector,
		wid: number,
		h: number,
		opac: number,
		numHit: number
		) => <BrickBody>{
			position: pos,
			width: wid,
			height: h,
			opacity: opac,
			numberOfHits: numHit
	};

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
	}

	// two mutator methods that instantiate a new object/number (used in order to have more terse code later on)
	const incrementScore = (score: number, hasWonPoint: boolean) => score + (hasWonPoint ? 1 : 0)
	const calculateBallBounce = (ball:NewtonianBody,isballBounceOnBorder:boolean,  isballBounceOnPaddle:boolean, paddleAimVerticalError:number) =>
	<NewtonianBody>{...ball,
		velocity:
			isballBounceOnPaddle
				?  calcBouncedVelocity(ball.velocity,paddleAimVerticalError)
				:  isballBounceOnBorder ? ball.velocity.flipY() : ball.velocity
	}

	const moveObject = (o: NewtonianBody) => <NewtonianBody>{
		...o,
		position: o.position.add(o.velocity)
	}

	const objInteractionHandling = (s: State) =>{
		// this function just about looks after all objects interactions
		const
		//extracting some frequently used variables
			ballPos = s.ball.position,
			compBarPos = s.computerBar.position, 
			playBarPos = s.playerBar.position,

			isballp1Endzone =  ballPos.x <= Constants.Zero,
			isballp2Endzone =  ballPos.x >= Constants.CanvasSize,
			newP1Score = incrementScore(s.p1Score, isballp2Endzone),
			newP2Score = incrementScore(s.p2Score, isballp1Endzone),

			// handeling of ball collision with significant borders
			isballBounceOnLeftBar = (ballPos.x - s.ball.size - Constants.BarWidth <= Constants.CanvasSize / 8 && ballPos.x >= Constants.CanvasSize / 8 - 10
											&& (ballPos.y >= playBarPos.y
											&& ballPos.y <= playBarPos.y + Constants.BarHeight)),
			isballBounceOnRightBar = (ballPos.x + s.ball.size >= 7 * Constants.CanvasSize / 8 && ballPos.x <= 7 * Constants.CanvasSize / 8 + 10
											&& (ballPos.y >= compBarPos.y
											&& ballPos.y <= compBarPos.y + Constants.BarHeight)),
			isballBounceOnBorder = ballPos.y <= Constants.Zero || ballPos.y >= Constants.CanvasSize,
			// gives a relative position of the ball to the paddle (anchored at the most upper point of the paddle)
			paddleAimVerticalError = isballBounceOnLeftBar ?  playBarPos.y - ballPos.y :
									isballBounceOnRightBar ?  compBarPos.y - ballPos.y :
									 0;
					
			return <State>{
				...s,
				p1Score: newP1Score,
				p2Score: newP2Score,
				ball: isballp1Endzone || isballp2Endzone ?
						// restarting the ball to center position
						createBall() : 
						// returns a vector at which the ball bounces at
						calculateBallBounce(s.ball, isballBounceOnBorder, isballBounceOnLeftBar || isballBounceOnRightBar, paddleAimVerticalError),
				computerBar: Math.sign(s.ball.velocity.x) ? // ensures the computerBar only moves when the ball is traveling it its direction (and not when traveling away)
							<NewtonianBody>{...s.computerBar, 
								position: s.computerBar.position.alterY(Math.sign(s.computerBar.position.y - ballPos.y + Constants.BarHeight/2) === -1 ? 
								// getComputerBarSpeed() is with respect to the user defined game difficulty (the greater the difficulty the faster the computerBar moves)
								s.computerBar.position.y + getComputerBarSpeed() : 
								s.computerBar.position.y - getComputerBarSpeed())} :
							s.computerBar,
							// holding the number of the player who won
				endOfGame: 	newP1Score === Constants.maxScore ? Constants.playerBarNum : 
							newP2Score === Constants.maxScore ? Constants.computerBarNum :
							0
			}	
	}

	const tick = (s:State,elapsed:number) => 
		objInteractionHandling(<State>{
			...s,
			time: elapsed,
			ball: moveObject(s.ball)
		})
	
	// used as a part of scan which is the accumulated current state
	const reduceState = (s: State, eve: Tick|Slide) =>
		eve instanceof Slide ? {
			...s,
			playerBar: <NewtonianBody>{ ...s.playerBar, 
				position: s.playerBar.position.add(new Vector(0, eve.direction)).y <= Constants.CanvasSize - Constants.BarHeight
						&& s.playerBar.position.add(new Vector(0, eve.direction)).y >= Constants.Zero ? 
						s.playerBar.position.add(new Vector(0, eve.direction)):
						s.playerBar.position}
		} :
			tick(s, eve.elapsed);

// HEART: this is where we subscribe to the actions of the game accepting the user inputs
	const subscription = interval(10).pipe(
		map(elapsed => new Tick(elapsed)),
		merge(
			startDownSlide,
			startUpSlide,
			stopUpSlide,
			stopDownSlide),
			//repeatWhen(() => fromEvent<MouseEvent>(document.getElementById("restartGameButton")!, 'onclick')),
		scan(reduceState, initialState)).subscribe(updateView);


	function updateView(s: State) {
		// almost all the major side-effects are contained within this method (as per its necessity for RXJS to work)
		const 
			canvas = document.getElementById("svg_background")!,
			setAttrib = (el:Element,obj:any) => {for(const k in obj) el!.setAttribute(k,String(obj[k]))},
			setInner = (el:Element,obj:any) => {for(const k in obj) el!.innerHTML = String(obj[k])};

		// Design note: all static (non-breakout version) objects are pre-created in the svg instead from TS code.
		// the reason for this was two fold, one most of the objects are static (not being dynamically placed)
		// second is that when the page is refreshed I was trying to avoid the objects jumping between two places (one set in HTML the other in TS) 
		// for the breakout version (with dynamic objects) attributes are set on the fly

		setInner(document.getElementById("playerScore1"), s.p1Score)
		setInner(document.getElementById("playerScore2"), s.p2Score)

		setAttrib(document.getElementById("playerBar1"), {x: s.playerBar.position.x, y: s.playerBar.position.y})
		setAttrib(document.getElementById("playerBar2"), {x: s.computerBar.position.x, y: s.computerBar.position.y})
		setAttrib(document.getElementById("ball"), {cx: s.ball.position.x, cy: s.ball.position.y})

		if(s.isBreakout){
			// append bricks to canvas
		}
		
		if (s.endOfGame) {
			subscription.unsubscribe();
			const endGameObj = document.createElementNS(canvas.namespaceURI, "text")!;
			setAttrib(endGameObj, { x: Constants.CanvasSize / 20, y: Constants.CanvasSize / 2, class: ("GameOverText")});
			endGameObj.textContent = "player " + String(s.endOfGame) + " is the winner winner chicken dinner!";
			canvas.appendChild(endGameObj);
		}
	}
}

if (typeof window != 'undefined')
	window.onload = () => {
		pong();
	}



