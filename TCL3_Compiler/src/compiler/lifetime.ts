import { ASTType, ASTTypeRef } from "../parser/ast.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";

enum LifetimeState {
	Uninitialized = "Uninitialized",
	Live = "Live",
	Dead = "Dead"
}

enum LifetimeMergeAction {
	Drop = "Drop",
	DropInOtherBranches = "DropInOtherBranches"
}

interface LifetimeMergeResult {
	name: string;
	action: LifetimeMergeAction;
}

class Lifetime {
	public states: Map<string, { state: LifetimeState; type: ASTTypeRef }> = new Map();
	private name: string;

	public get alive() {
		const aliveVars: string[] = [];
		this.states.forEach((stateEntity, name) => {
			if (stateEntity.state == LifetimeState.Live) {
				aliveVars.push(name);
			}
		});

		return aliveVars;
	}

	public constructor(
		private compiler: Compiler,
		parent: FunctionContext | Lifetime
	) {
		if (parent instanceof FunctionContext) {
			parent.getLocalsForLifetimeInit().forEach(local => {
				if (local.type.type != ASTType.RawTypeRef) return;
				const struct = this.compiler.structs.get(local.type.rawType);
				if (!struct || !struct.hasDrop) return;

				this.states.set(local.name, {
					state: local.isParameter ? LifetimeState.Live : LifetimeState.Uninitialized,
					type: local.type
				});
			});

			this.name = parent.name;
		} else {
			parent.states.forEach((stateEntity, name) => {
				this.states.set(name, { ...stateEntity });
			});

			this.name = `Child of ${parent.name}`;
		}

		console.log(`Lifetime init for ${this.name}:`);
		this.logState();
	}

	public logState() {
		this.states.forEach((stateEntity, name) => {
			console.log(` - ${name}: ${LifetimeState[stateEntity.state]}`);
		});
	}

	public kill(name: string) {
		if (!this.states.has(name)) return;
		this.states.get(name).state = LifetimeState.Dead;

		console.log(`Kill ${name} in ${this.name}`);
		this.logState();
	}

	public initialize(name: string) {
		if (!this.states.has(name)) return;
		this.ensure(name, LifetimeState.Uninitialized);
		this.states.get(name).state = LifetimeState.Live;

		console.log(`Initialize ${name} in ${this.name}`);
		this.logState();
	}

	public makeAlive(name: string) {
		if (!this.states.has(name)) return;
		this.ensure(name, LifetimeState.Dead);
		this.states.get(name).state = LifetimeState.Live;

		console.log(`Make alive ${name} in ${this.name}`);
		this.logState();
	}

	public getMergeActionsForChild(child: Lifetime) {
		const actions: LifetimeMergeResult[] = [];

		child.states.forEach((childStateEntity, name) => {
			const local = this.states.get(name);
			if (!local && childStateEntity.state == LifetimeState.Live) {
				console.log(`Locally declared variable ${name} is live in child lifetime but does not exist in parent lifetime, needs drop`);
				actions.push({ name, action: LifetimeMergeAction.Drop });
				return;
			}

			if (local.state == LifetimeState.Live && childStateEntity.state == LifetimeState.Dead) {
				console.log(`Local ${name} is dropped in child lifetime, needs other-branch drop`);
				actions.push({ name, action: LifetimeMergeAction.DropInOtherBranches });
				return;
			}

			if (local.state == LifetimeState.Dead && childStateEntity.state == LifetimeState.Live) {
				// We do not allow a child lifetime to resurrect a variable that was dropped in parent
				// If the lifetime seems to do this, instead we will just drop it in the child lifetime and keep it dead in the parent lifetime
				console.log(`Local ${name} is alive in child lifetime, needs drop`);
				actions.push({ name, action: LifetimeMergeAction.Drop });
				return;
			}

			console.log(`Local ${name} is ${LifetimeState[local.state]} in parent and ${LifetimeState[childStateEntity.state]} in child (no action needed)`);
		});

		return actions;
	}

	private ensure(name: string, ...expectedStates: LifetimeState[]) {
		const stateEntity = this.states.get(name);
		if (!expectedStates.includes(stateEntity.state)) {
			throw new Error(`Lifetime state for ${name} is ${stateEntity.state}, expected ${expectedStates.join(", ")}`);
		}
	}
}

export { Lifetime, LifetimeState, LifetimeMergeAction, LifetimeMergeResult };
