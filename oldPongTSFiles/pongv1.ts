import { interval, fromEvent, from, zip } from 'rxjs'
import { map, scan, filter, merge, flatMap, take, concat, takeUntil, single } from 'rxjs/operators'

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
		readonly svgObjScorePrefix = 'playerScore';
		readonly svgObjBarPrefix = 'playerBar';
		readonly svgObjBall = 'ball';
		readonly maxScore = 7;
		readonly playerBarNum = 1;
		readonly computerBarNum = 2;
	}
	const getComputerBarSpeed = () => parseInt((document.getElementById("difficultyRange")! as HTMLInputElement).value)/35;


class Vector {
	constructor(public readonly x: number = 0, public readonly y: number = 0) {}
	add = (v: Vector) => new Vector(this.x + v.x, this.y + v.y)
	subtract = (v: Vector) => this.add(v.eigenValueScale(-1))
	eigenValueScale = (s: number) => new Vector(this.x * s, this.y * s)
	flipY = () => new Vector(this.x, -this.y)
	flipX = () => new Vector(-this.x, this.y)
	alterY = (y: number) => new Vector(this.x, y)
	bouncedVec = (incomingPos: number) => new Vector(-this.x, (Constants.maxBounceAngle * -(incomingPos+Constants.BarHeight/2) / (Constants.BarHeight/2)/100))
	static Zero = new Vector();
}

const keyObservable = <T>(event: Event, key: Key, movementResult: () => T) =>
	fromEvent<KeyboardEvent>(document, event)
		.pipe(filter(({ code }) => code === key),
			map(movementResult))


type Bod = Readonly<{
	id: string,
	position: Vector,
	acceleration?: Vector,
	velocity: Vector,
	hORr: number
}>

type ScoreTemplate = Readonly<{
	id: string,
	position: Vector,
	score: number,
	player: number
}>

type State = Readonly<{
	time: number,
	playerBar: Bod,
	computerBar: Bod,
	ball: Bod,
	p1Score: ScoreTemplate,
	p2Score: ScoreTemplate,
	endOfGame: number
}>

function pong() {
	// Document your code!

	class Tick { constructor(public readonly elapsed: number) { } }
	class Slide { constructor(public readonly direction: number) { } }

	const
		startDownSlide = keyObservable('keydown', 'ArrowUp', () => new Slide(-10)),
		startUpSlide = keyObservable('keydown', 'ArrowDown', () => new Slide(10)),
		stopUpSlide = keyObservable('keyup', 'ArrowUp', () => new Slide(0)),
		stopDownSlide = keyObservable('keyup', 'ArrowDown', () => new Slide(0))


	const createScore = (
		p: number, 
		score: number, 
		pos: Vector = new Vector(p === 1 ? Constants.CanvasSize / 6 : p === 2 ? 5 * Constants.CanvasSize / 6 : 0, Constants.CanvasSize / 6)
		) => <ScoreTemplate>{
			id: Constants.svgObjScorePrefix + String(p),
			position: pos,
			score: score,
			player: p
	};

	const createBar = (
		p: number, 
		pos: Vector = new Vector(p === 1 ? Constants.CanvasSize / 8 : p === 2 ? 7 * Constants.CanvasSize / 8 : 0, Constants.CanvasSize / 2 - Constants.BarHeight/2), 
		acc: Vector = Vector.Zero, 
		height: number = Constants.BarHeight
		) => <Bod>{
			id: Constants.svgObjBarPrefix + String(p),
			position: pos,
			acceleration: acc,
			hORr: height
	};

	const createBall = (
		pos: Vector = new Vector(Constants.CanvasSize/2, Constants.CanvasSize/2),
		acc: Vector = Vector.Zero,
		vel: Vector = new Vector(Math.random() > 0.5 ? 3 : -3, Constants.Zero),
		radius: number = Constants.BallRadius
		) => <Bod>{
			id: Constants.svgObjBall,
			position: pos,
			acceleration: acc,
			velocity: vel,
			hORr: radius
	};

	const initialState: State = {
		time: 0,
		playerBar: createBar(Constants.playerBarNum),
		computerBar: createBar(Constants.computerBarNum),
		ball: createBall(),
		p1Score: createScore(Constants.playerBarNum, 0),
		p2Score: createScore(Constants.computerBarNum, 0),
		endOfGame: 0
	}

	const moveObject = (o: Bod) => <Bod>{
		...o,
		position: o.position.add(o.velocity)
	}

	const objInteractionHandling = (s: State) =>{
		const
			ballp1Endzone = () => s.ball.position.x <= Constants.Zero ? 1 : 0,
			ballp2Endzone = () => s.ball.position.x >= Constants.CanvasSize ? 1 : 0,
			gameEnd = () => ballp1Endzone() + s.p1Score.score === Constants.maxScore ? Constants.playerBarNum 
							: ballp2Endzone() + s.p2Score.score === Constants.maxScore ? Constants.computerBarNum 
							: 0,
			ballBounceOnLeftBar = () => (s.ball.position.x - s.ball.hORr - Constants.BarWidth <= Constants.CanvasSize / 8 && s.ball.position.x >= Constants.CanvasSize / 8 - 10
											&& (s.ball.position.y >= s.playerBar.position.y
											&& s.ball.position.y <= s.playerBar.position.y + Constants.BarHeight)),
			ballBounceOnRightBar = () => (s.ball.position.x + s.ball.hORr >= 7 * Constants.CanvasSize / 8 && s.ball.position.x <= 7 * Constants.CanvasSize / 8 + 10
											&& (s.ball.position.y >= s.computerBar.position.y
											&& s.ball.position.y <= s.computerBar.position.y + Constants.BarHeight)),
			ballBounceOnBoarder = () => s.ball.position.y <= Constants.Zero || s.ball.position.y >= Constants.CanvasSize;

			const ballReturn = () => Boolean(ballp1Endzone()) || Boolean(ballp2Endzone()) ?
										createBall() : 
									ballBounceOnLeftBar() ? 
										<Bod>{...s.ball, velocity: s.ball.velocity.bouncedVec(s.playerBar.position.y - s.ball.position.y)} :
									ballBounceOnRightBar() ? 
										<Bod>{...s.ball, velocity: s.ball.velocity.bouncedVec(s.computerBar.position.y - s.ball.position.y)} : 
									ballBounceOnBoarder() ? 
										<Bod>{...s.ball, velocity: s.ball.velocity.flipY()} :
										s.ball
					
			return <State>{
				...s,
				p1Score: <ScoreTemplate>{...s.p1Score, score: s.p1Score.score + ballp2Endzone()},
				p2Score: <ScoreTemplate>{...s.p2Score, score: s.p2Score.score + ballp1Endzone()},
				ball: ballReturn(),
				computerBar: Math.sign(s.ball.velocity.x) ?
							<Bod>{...s.computerBar, position: s.computerBar.position.alterY(Math.sign(s.computerBar.position.y - s.ball.position.y + Constants.BarHeight/2)===-1 ? s.computerBar.position.y + getComputerBarSpeed() : s.computerBar.position.y - getComputerBarSpeed())} :
							s.computerBar,
				endOfGame: gameEnd()
		}	
	}

	const tick = (s:State,elapsed:number) => 
		objInteractionHandling(<State>{
			...s,
			time: elapsed,
			ball: moveObject(s.ball)
		})
	

	const reduceState = (s: State, eve: Tick|Slide) =>
		eve instanceof Slide ? {
			...s,
			playerBar: <Bod>{ ...s.playerBar, 
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
		scan(reduceState, initialState)).subscribe(updateView);

	function updateView(s: State) {

		const svg = document.getElementById("svg_background")!,
			player1ScoreNum = document.getElementById(s.p1Score.id)!, player2ScoreNum = document.getElementById(s.p2Score.id)!,
			currBar1 = document.getElementById(s.playerBar.id)!, currBar2 = document.getElementById(s.computerBar.id)!,
			currBall = document.getElementById(s.ball.id)!;
		
		if (s.time === 0){
			player1ScoreNum.setAttribute('x', String(s.p1Score.position.x))
			player1ScoreNum.setAttribute('y', String(s.p1Score.position.y))
			player2ScoreNum.setAttribute('x', String(s.p2Score.position.x-15))
			player2ScoreNum.setAttribute('y', String(s.p2Score.position.y))
		}

		if (player1ScoreNum){player1ScoreNum.innerHTML = String(s.p1Score.score)}
		if (player2ScoreNum){player2ScoreNum.innerHTML = String(s.p2Score.score)}

		if (currBar1){
			currBar1.setAttribute('x', String(s.playerBar.position.x))
			currBar1.setAttribute('y', String(s.playerBar.position.y))}

		if (currBar2){
			currBar2.setAttribute('x', String(s.computerBar.position.x))
			currBar2.setAttribute('y', String(s.computerBar.position.y))}

		if (currBall){		
			currBall.setAttribute('cx', String(s.ball.position.x))
			currBall.setAttribute('cy', String(s.ball.position.y))}


		const attr = (el:Element,obj:any) => {for(const k in obj) el.setAttribute(k,String(obj[k]))}
		
		if (s.endOfGame) {
			subscription.unsubscribe();
			const v = document.createElementNS(svg.namespaceURI, "text")!;
			attr(v, { x: Constants.CanvasSize / 20, y: Constants.CanvasSize / 2, class: ("GameOverText")});
			v.textContent = "player " + String(s.endOfGame) + " is the winner winner chicken dinner!";
			svg.appendChild(v);
		}
	}
}

if (typeof window != 'undefined')
	window.onload = () => {
		pong();
	}



