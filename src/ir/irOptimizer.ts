import { IRArgument, IRCodeLine, IRLine, IROpCode, IRProgram, Register } from "./ir.js";
import { imm, reg } from "./irBuilder.js";

const MISS_CYCLES_BEFORE_EXIT = 3;

class IROptimizer {
	private code: IRLine[];
	private strings: string[];

	private noSizeReductionCycles = 0;

	constructor(program: IRProgram) {
		this.code = [...program.code];
		this.strings = [...program.strings];
	}

	public optimize(): IRProgram {
		let lastLength = this.code.length;

		while (this.noSizeReductionCycles < MISS_CYCLES_BEFORE_EXIT) {
			this.updateMathMoveInstructions();
			this.removeNoOpInstructions();
			this.removePushPopPairs();

			if (this.code.length === lastLength) this.noSizeReductionCycles++;
			else this.noSizeReductionCycles = 0;

			lastLength = this.code.length;
		}

		return {
			code: this.code,
			strings: this.strings
		};
	}

	private checkModifies(line: IRCodeLine, arg: IRArgument): boolean {
		const nonModifyingOpcodes: IROpCode[] = ["NOP", "PUSH", "JMP_IF_FALSE", "JMP_IF_TRUE", "HALT", "OUT"];
		if (nonModifyingOpcodes.includes(line.opcode)) return false;

		const lastArg = line.args[line.args.length - 1];
		if (lastArg.equals(arg)) return true;
		return false;
	}

	private isReferenced(lines: IRLine[], arg: IRArgument): boolean {
		if (arg.type === "IMM") return false;
		return lines.some(line => {
			if (!(line instanceof IRCodeLine)) return false;
			return line.args.some(a => a.equals(arg));
		});
	}

	private containsJump(lines: IRLine[]): boolean {
		return lines.some(line => {
			if (!(line instanceof IRCodeLine)) return false;
			if (line.opcode == "JMP_IF_FALSE") return true;
			if (line.opcode == "JMP_IF_TRUE") return true;
			if (line.opcode == "MOV" && line.args[1].equals(reg(Register.pc))) return true;
		});
	}

	private containsStackOp(lines: IRLine[]): boolean {
		return lines.some(line => {
			if (!(line instanceof IRCodeLine)) return false;
			if (line.opcode == "PUSH" || line.opcode == "POP") return true;
			const someArgIsSpReg = line.args.some(arg => {
				return (arg.type === "REG" && arg.value === Register.sp) || (arg.type === "MEM_REG" && arg.value === Register.sp);
			});

			if (someArgIsSpReg) return true;

			return false;
		});
	}

	private isModifiedWithin(lines: IRLine[], register: Register): boolean {
		return lines.some(line => {
			if (!(line instanceof IRCodeLine)) return false;

			if (register == Register.sp) {
				if (line.opcode == "PUSH" || line.opcode == "POP") return true;
			}

			return this.checkModifies(line, reg(register));
		});
	}

	private removePushPopPairs() {
		for (let i = 0; i < this.code.length - 1; i++) {
			if (!(this.code[i] instanceof IRCodeLine) || !(this.code[i + 1] instanceof IRCodeLine)) continue;

			const push = this.code[i] as IRCodeLine;
			if (push.opcode != "PUSH") continue;

			let popIdx = -1;
			for (let j = i + 1; j < this.code.length; j++) {
				if (!(this.code[j] instanceof IRCodeLine)) continue;
				const line = this.code[j] as IRCodeLine;
				if (line.opcode == "POP") {
					popIdx = j;
					break;
				}
			}
			if (popIdx == -1) continue;

			const pop = this.code[popIdx] as IRCodeLine;

			const betweenLines = this.code.slice(i + 1, popIdx);

			// If where we want to pop to is referenced can't safely direct write
			if (this.isReferenced(betweenLines, pop.args[0])) continue;
			// If we jump somewhere else who knows whats goin on
			if (this.containsJump(betweenLines)) continue;
			// If do any stack ops can't safely direct write
			if (this.containsStackOp(betweenLines)) continue;
			// Check if we're poping to a mem reg and the register is modified in between, can't safely direct write
			if (pop.args[0].type == "MEM_REG" && this.isModifiedWithin(betweenLines, pop.args[0].value as Register)) continue;

			const mov = new IRCodeLine("MOV", push.args[0], pop.args[0]);
			this.code.splice(i, 1, mov);
			this.code.splice(popIdx, 1);
			i--; // Re-evaluate the current index after the splice
		}
	}

	// Changes ADD, SUB, MUL, and DIV instructions that have an immediate value of 0 or 1 to a MOV instruction
	private updateMathMoveInstructions() {
		this.code = this.code.map(l => {
			if (!(l instanceof IRCodeLine)) return l;

			switch (l.opcode) {
				case "ADD":
					if (l.args[0].equals(imm(0))) return new IRCodeLine("MOV", l.args[1], l.args[2]);
					if (l.args[1].equals(imm(0))) return new IRCodeLine("MOV", l.args[0], l.args[2]);
					break;
				case "SUB":
					if (l.args[1].equals(imm(0))) return new IRCodeLine("MOV", l.args[0], l.args[2]);
					break;
				case "MUL":
					if (l.args[0].equals(imm(1))) return new IRCodeLine("MOV", l.args[1], l.args[2]);
					if (l.args[1].equals(imm(1))) return new IRCodeLine("MOV", l.args[0], l.args[2]);
					if (l.args[0].equals(imm(0)) || l.args[1].equals(imm(0))) return new IRCodeLine("MOV", imm(0), l.args[2]);
					break;
				case "DIV":
					if (l.args[1].equals(imm(1))) return new IRCodeLine("MOV", l.args[0], l.args[2]);
					break;
			}

			return l;
		});
	}

	// Removes NOP instructions and MOV instructions that move a register to itself
	private removeNoOpInstructions() {
		this.code = this.code.filter(l => {
			if (!(l instanceof IRCodeLine)) return true;
			switch (l.opcode) {
				case "NOP":
					return false;
				case "MOV":
					return !l.args[0].equals(l.args[1]);
				default:
					return true;
			}
		});
	}
}

export { IROptimizer };
