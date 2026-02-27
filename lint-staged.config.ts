export default {
	"*.{js,jsx,ts,tsx}": ["biome format --write", "biome lint"],
	"*.{json,css,html}": ["biome format --write"],
	"*.{ts,tsx}": () => {
		return "tsgo -p tsconfig.json --noEmit";
	},
};
