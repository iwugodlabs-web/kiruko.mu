/**
 * Icons are pulled from https://icones.js.org
 */

import { createIcon } from "@gluestack-ui/themed";
import { G, Path } from "react-native-svg";

const MynauiLockPasswordSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path
        strokeWidth="0"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        d="M16.75 8c0-1.478-.33-2.901-1.107-3.975c-.8-1.107-2.03-1.775-3.643-1.775s-2.842.668-3.643 1.775C7.58 5.099 7.25 6.522 7.25 8v1.25h-.58c-.535 0-.98 0-1.345.03c-.38.031-.736.098-1.073.27a2.75 2.75 0 0 0-1.202 1.202c-.172.337-.24.694-.27 1.074c-.03.364-.03.81-.03 1.344v4.66c0 .535 0 .98.03 1.345c.03.38.098.737.27 1.074a2.75 2.75 0 0 0 1.202 1.202c.337.172.693.239 1.073.27c.365.03.81.03 1.345.03h10.66c.535 0 .98 0 1.345-.03c.38-.031.736-.098 1.073-.27a2.75 2.75 0 0 0 1.202-1.202c.172-.337.24-.694.27-1.074c.03-.364.03-.81.03-1.344V13.17c0-.534 0-.98-.03-1.344c-.03-.38-.098-.737-.27-1.074a2.75 2.75 0 0 0-1.2-1.202c-.338-.172-.694-.239-1.074-.27c-.365-.03-.81-.03-1.345-.03h-.58zm-8 0c0-1.283.29-2.36.822-3.096c.51-.703 1.28-1.154 2.428-1.154s1.919.45 2.428 1.154c.532.736.822 1.813.822 3.096v1.25h-6.5zm4 7.25v.5a.75.75 0 0 1-1.5 0v-.5a.75.75 0 0 1 1.5 0M16 14.5a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-1.5 0v-.5a.75.75 0 0 1 .75-.75m-7.25.75v.5a.75.75 0 0 1-1.5 0v-.5a.75.75 0 0 1 1.5 0"
      ></Path>
    </>
  ),
});

MynauiLockPasswordSolid.displayName = "MynauiLockPasswordSolid";
export { MynauiLockPasswordSolid };

const MynauiEye = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <G strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M2.55 13.406c-.272-.373-.408-.56-.502-.92a2.5 2.5 0 0 1 0-.971c.094-.361.23-.548.502-.92C4.039 8.55 7.303 5 12 5s7.961 3.55 9.45 5.594c.272.373.408.56.502.92a2.5 2.5 0 0 1 0 .971c-.094.361-.23.548-.502.92C19.961 15.45 16.697 19 12 19s-7.961-3.55-9.45-5.594"></Path>
        <Path d="M12 14a2 2 0 1 0 0-4a2 2 0 0 0 0 4"></Path>
      </G>
    </>
  ),
});

MynauiEye.displayName = "MynauiEye";
export { MynauiEye };

const BasilUserSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path
        strokeWidth="0"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        d="M12 3.75a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5m-4 9.5A3.75 3.75 0 0 0 4.25 17v1.188c0 .754.546 1.396 1.29 1.517c4.278.699 8.642.699 12.92 0a1.54 1.54 0 0 0 1.29-1.517V17A3.75 3.75 0 0 0 16 13.25h-.34q-.28.001-.544.086l-.866.283a7.25 7.25 0 0 1-4.5 0l-.866-.283a1.8 1.8 0 0 0-.543-.086z"
      ></Path>
    </>
  ),
});

BasilUserSolid.displayName = "BasilUserSolid";
export { BasilUserSolid };