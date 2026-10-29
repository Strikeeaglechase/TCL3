interface TCL3Config {
	entrypoint: string;
	output?: string;
	noEmit?: boolean;
	optimize: boolean;
}

const defaultTcl3Config: Partial<TCL3Config> = {
	optimize: true
};

function validateConfig(config: any): asserts config is TCL3Config {
	if (!config || typeof config != "object") throw new Error("Invalid config: must be an object");
	if (typeof config.entrypoint != "string") throw new Error("Invalid config: entrypoint must be a string");
	if (!config.noEmit && typeof config.output != "string") throw new Error("Invalid config: output must be provided if noEmit is not true");
}

export { TCL3Config, defaultTcl3Config, validateConfig };
