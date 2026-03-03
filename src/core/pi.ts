const PI_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";
const ENABLED_VALUE = "1";

export function disablePiVersionCheck(): void {
	process.env[PI_SKIP_VERSION_CHECK] = ENABLED_VALUE;
}
