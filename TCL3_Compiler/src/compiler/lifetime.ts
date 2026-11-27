import { ASTType, ASTTypeRef } from "../parser/ast.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";

enum LifetimeState {
	Uninitialized = "Uninitialized",
	Live = "Live",
	Dead = "Dead"
}

class Lifetime {
	public states: Map<string, { state: LifetimeState; type: ASTTypeRef }> = new Map();
	private name: string;

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

	public performMergeWithChild(child: Lifetime) {
		child.states.forEach((childStateEntity, name) => {
			const local = this.states.get(name);
			if (!local && childStateEntity.state == LifetimeState.Live) {
				console.log(`Locally declared variable ${name} is live in child lifetime but does not exist in parent lifetime, needs drop`);
				return;
			}

			if (local.state == LifetimeState.Live && childStateEntity.state == LifetimeState.Dead) {
				console.log(`Local ${name} is sometimes dropped in child lifetime, needs other-branch drop`);
				return;
			}

			if (local.state == LifetimeState.Dead && childStateEntity.state == LifetimeState.Live) {
				console.log(`Local ${name} is sometimes alive in child lifetime, needs to be marked as alive in parent lifetime (for later drop)`);
				return;
			}

			console.log(`Local ${name} is ${LifetimeState[local.state]} in parent and ${LifetimeState[childStateEntity.state]} in child (no action needed)`);
		});
	}

	private ensure(name: string, ...expectedStates: LifetimeState[]) {
		const stateEntity = this.states.get(name);
		if (!expectedStates.includes(stateEntity.state)) {
			throw new Error(`Lifetime state for ${name} is ${stateEntity.state}, expected ${expectedStates.join(", ")}`);
		}
	}
}

export { Lifetime, LifetimeState };
