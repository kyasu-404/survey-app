import blackLogo from "../../img/black_logo.png";
import whiteLogo from "../../img/white_logo.png";
import type { ThemeId } from "../../shared/theme/themeRegistry";

export function getDefaultAppLogo(themeId: ThemeId) {
  return themeId === "graphite" ? whiteLogo : blackLogo;
}
