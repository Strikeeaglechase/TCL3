import { IRArgument, IRCodePoint, IROpCode, Register } from "./compiler/ir.js";

const memSize = 1024 * 64; // 64KB

function isIrArgArr(arr: IRCodePoint[]): arr is IRArgument[] {
	return arr.every(arg => arg instanceof IRArgument);
}

class Emulator {
	private registers: Record<Register, number> = {
		[Register.pc]: 0,
		[Register.sp]: 0,
		[Register.fp]: 0,
		[Register.memPtr]: 0,
		[Register.r0]: 0,
		[Register.r1]: 0,
		[Register.offset]: 0
	};

	private memory: IRCodePoint[] = new Array(memSize).fill(0);
	private running: boolean = true;
	private ticks = 0;

	public execute(code: IRCodePoint[]) {
		this.memory.splice(0, code.length, ...code);

		this.registers.fp = code.length + 5;
		this.registers.sp = code.length + 5;

		while (this.running) {
			const opcode = this.memory[this.registers.pc];
			if (typeof opcode !== "string") throw new Error(`Invalid opcode at address ${this.registers.pc}: ${opcode}`);

			const args = this.memory.slice(this.registers.pc + 1, this.registers.pc + 4);
			if (!isIrArgArr(args)) throw new Error(`Invalid argument at address ${this.registers.pc}: ${args.join(", ")}`);

			this.executeInstruction(opcode, args);
			this.registers.pc += 4;

			this.ticks++;
		}

		console.log(`Execution finished after ${this.ticks} ticks.`);
	}

	private executeInstruction(opcode: IROpCode, args: IRArgument[]) {
		console.log(`PC: ${this.registers.pc} - ${opcode} ${args.join(", ")}`);
		switch (opcode) {
			case "MOV":
				this.mov(args[0], args[1]);
				break;

			case "ADD":
				const sum = this.getValue(args[0]) + this.getValue(args[1]);
				this.setValue(args[2], sum);
				break;

			case "SUB":
				const diff = this.getValue(args[0]) - this.getValue(args[1]);
				this.setValue(args[2], diff);
				break;

			case "MUL":
				const prod = this.getValue(args[0]) * this.getValue(args[1]);
				this.setValue(args[2], prod);
				break;

			case "DIV":
				const quotient = Math.floor(this.getValue(args[0]) / this.getValue(args[1]));
				this.setValue(args[2], quotient);
				break;

			case "NOP":
				break;

			case "HALT":
				this.running = false;
				break;

			case "OUT":
				const value = this.getValue(args[0]);
				console.log(`OUT: ${value}`);
				break;

			case "INSPECT":
				this.handleInspect();
				break;

			default:
				throw new Error(`Unknown opcode: ${opcode}`);
		}
	}

	private handleInspect() {
		let registerOutput = `Tick: ${this.ticks} | `;
		Object.entries(this.registers).forEach(([reg, value]) => {
			registerOutput += `${reg}: ${value} | `;
		});

		console.log(registerOutput);
	}

	private mov(src: IRArgument, dest: IRArgument) {
		const value = this.getValue(src);
		this.setValue(dest, value);
	}

	private setValue(arg: IRArgument, value: number) {
		switch (arg.type) {
			case "MEM":
				this.memory[parseInt(arg.value)] = value;
				break;
			case "MEM_REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register];
				this.memory[addr] = value;
				break;
			case "REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				this.registers[arg.value as Register] = value;
				break;
			default:
				throw new Error(`Unsupported argument type for setValue: ${arg.type}`);
		}
	}

	private getValue(arg: IRArgument): number {
		switch (arg.type) {
			case "IMM":
				return parseInt(arg.value);
			case "REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				return this.registers[arg.value as Register];
			case "MEM":
				const val = this.memory[parseInt(arg.value)];
				if (typeof val != "number") throw new Error(`Invalid memory access at address ${arg.value}: ${val}`);
				return val;
			case "MEM_REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register];
				const memVal = this.memory[addr];
				if (typeof memVal != "number") throw new Error(`Invalid memory access at address ${addr}: ${memVal}`);
				return memVal;
			default:
				throw new Error(`Unsupported argument type: ${arg.type}`);
		}
	}
}

export { Emulator };
