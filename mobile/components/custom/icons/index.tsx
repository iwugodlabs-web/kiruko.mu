/**
 * Icons are pulled from https://icones.js.org
 */

import { createIcon } from "@gluestack-ui/themed";
import { Palette } from '@/app/constants/theme';
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

const Fa6RegularAddressCard = createIcon({
  viewBox: "0 0 576 512",
  path: (
    <>
      <Path fill={Palette.gray500} d="M512 80c8.8 0 16 7.2 16 16v320c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V96c0-8.8 7.2-16 16-16zM64 32C28.7 32 0 60.7 0 96v320c0 35.3 28.7 64 64 64h448c35.3 0 64-28.7 64-64V96c0-35.3-28.7-64-64-64zm144 224a64 64 0 1 0 0-128a64 64 0 1 0 0 128m-32 32c-44.2 0-80 35.8-80 80c0 8.8 7.2 16 16 16h192c8.8 0 16-7.2 16-16c0-44.2-35.8-80-80-80zm200-144c-13.3 0-24 10.7-24 24s10.7 24 24 24h80c13.3 0 24-10.7 24-24s-10.7-24-24-24zm0 96c-13.3 0-24 10.7-24 24s10.7 24 24 24h80c13.3 0 24-10.7 24-24s-10.7-24-24-24z"></Path>
    </>
  ),
});

Fa6RegularAddressCard.displayName = "Fa6RegularAddressCard";
export { Fa6RegularAddressCard };



const BasilCalendarSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} d="M7.75 4a.75.75 0 0 0-1.5 0v1.816a3.375 3.375 0 0 0-2.872 2.899l-.087.653q-.022.165-.042.332a.493.493 0 0 0 .492.55H20.26a.493.493 0 0 0 .492-.55l-.042-.332l-.087-.653a3.375 3.375 0 0 0-2.872-2.899V4a.75.75 0 0 0-1.5 0v1.668a48 48 0 0 0-8.5 0zm13.195 8.226a.494.494 0 0 0-.496-.476H3.551a.494.494 0 0 0-.496.476a29 29 0 0 0 .33 5.41a3.01 3.01 0 0 0 2.678 2.532l1.193.118c3.155.31 6.333.31 9.488 0l1.193-.118a3.01 3.01 0 0 0 2.678-2.532a29 29 0 0 0 .33-5.41"></Path>    </>
  ),
});

BasilCalendarSolid.displayName = "BasilCalendarSolid";
export { BasilCalendarSolid };


const BasilFileUserSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} fillRule="evenodd" d="M14.25 2.5a.25.25 0 0 0-.25-.25H7A2.75 2.75 0 0 0 4.25 5v14A2.75 2.75 0 0 0 7 21.75h10A2.75 2.75 0 0 0 19.75 19V9.147a.25.25 0 0 0-.25-.25H15a.75.75 0 0 1-.75-.75zM12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4m-4 8.5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1" clipRule="evenodd"></Path><Path fill={Palette.gray500} d="M15.75 2.824c0-.184.193-.301.336-.186q.182.147.323.342l3.013 4.197c.068.096-.006.22-.124.22H16a.25.25 0 0 1-.25-.25z"></Path>    </>
  ),
});

BasilFileUserSolid.displayName = "BasilFileUserSolid";
export { BasilFileUserSolid };


const BasilClockSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} fillRule="evenodd" d="M3.5 12a8.5 8.5 0 1 1 17 0a8.5 8.5 0 0 1-17 0m9.25-5a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 .352.636l3 1.875a.75.75 0 1 0 .796-1.272l-2.648-1.655z" clipRule="evenodd"></Path>    </>
  ),
});

BasilClockSolid.displayName = "BasilClockSolid";
export { BasilClockSolid };


const BasilEnvelopeOpenSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} d="M19.807 5.687c.298.245.546.55.727.897a.236.236 0 0 1-.091.307l-6.266 3.88a4.25 4.25 0 0 1-4.4.045L3.47 7.088a.236.236 0 0 1-.103-.293a2.9 2.9 0 0 1 .823-1.106v-.003l.012-.007a2.9 2.9 0 0 1 .894-.496l4.11-2.284a5.75 5.75 0 0 1 5.585 0l4.105 2.28c.334.114.641.286.908.505z"></Path><Path fill={Palette.gray500} d="M2.989 8.954a.248.248 0 0 1 .373-.187l5.653 3.34a5.75 5.75 0 0 0 5.951-.061l5.645-3.495a.248.248 0 0 1 .377.183a30.4 30.4 0 0 1-.161 7.78a2.89 2.89 0 0 1-2.606 2.447l-1.51.131a54.4 54.4 0 0 1-9.422 0l-1.51-.131a2.89 2.89 0 0 1-2.606-2.448a30.4 30.4 0 0 1-.184-7.559"></Path>    </>
  ),
});

BasilEnvelopeOpenSolid.displayName = "BasilEnvelopeOpenSolid";
export { BasilEnvelopeOpenSolid };


const BasilHomeOutline = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} fillRule="evenodd" d="M13.558 5.534a2.25 2.25 0 0 0-3.116 0l-4.626 4.44a.75.75 0 0 0-.218.405a27.3 27.3 0 0 0-.121 9.15l.112.721h2.977v-6.211a.75.75 0 0 1 .75-.75h5.368a.75.75 0 0 1 .75.75v6.211h2.977l.112-.72a27.3 27.3 0 0 0-.12-9.151a.75.75 0 0 0-.219-.405zM9.404 4.452a3.75 3.75 0 0 1 5.192 0l4.627 4.44c.34.326.57.752.655 1.216a28.9 28.9 0 0 1 .127 9.653l-.18 1.157a.98.98 0 0 1-.972.832h-4.169a.75.75 0 0 1-.75-.75v-6.211h-3.868V21a.75.75 0 0 1-.75.75H5.147a.98.98 0 0 1-.972-.832l-.18-1.157a28.9 28.9 0 0 1 .127-9.653c.085-.464.315-.89.655-1.217z" clipRule="evenodd"></Path>    </>
  ),
});

BasilHomeOutline.displayName = "BasilHomeOutline";
export { BasilHomeOutline };


const BasilClockOutline = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} d="M12.75 7a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 .352.636l3 1.875a.75.75 0 1 0 .796-1.272l-2.648-1.655z"></Path><Path fill={Palette.gray500} fillRule="evenodd" d="M12 3.25a8.75 8.75 0 1 0 0 17.5a8.75 8.75 0 0 0 0-17.5M4.75 12a7.25 7.25 0 1 1 14.5 0a7.25 7.25 0 0 1-14.5 0" clipRule="evenodd"></Path>    </>
  ),
});

BasilClockOutline.displayName = "BasilClockOutline";
export { BasilClockOutline };



const BasilBankOutline = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} fillRule="evenodd" d="M11.415 2.395a2 2 0 0 1 1.17 0l2.986.918a16.7 16.7 0 0 1 4.39 2.089c1.054.705.555 2.348-.713 2.348H4.752c-1.268 0-1.767-1.643-.714-2.348a16.7 16.7 0 0 1 4.391-2.09zm.73 1.434a.5.5 0 0 0-.29 0l-2.985.918A15.2 15.2 0 0 0 5.5 6.25h13a15.2 15.2 0 0 0-3.37-1.503z" clipRule="evenodd"></Path><Path fill={Palette.gray500} d="M4.25 21a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75m2-4a.75.75 0 0 0 1.5 0v-6a.75.75 0 0 0-1.5 0zm5.75.75a.75.75 0 0 1-.75-.75v-6a.75.75 0 0 1 1.5 0v6a.75.75 0 0 1-.75.75m4.25-.75a.75.75 0 0 0 1.5 0v-6a.75.75 0 0 0-1.5 0z"></Path>    </>
  ),
});

BasilBankOutline.displayName = "BasilBankOutline";
export { BasilBankOutline };


const BasilSettingsOutline = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path d="M11.199 2.587a1.65 1.65 0 0 1 1.602 0l7.2 4c.524.291.849.843.849 1.443v7.94c0 .6-.325 1.152-.849 1.443l-7.2 4a1.65 1.65 0 0 1-1.602 0l-7.2-4a1.65 1.65 0 0 1-.849-1.443V8.03c0-.6.325-1.152.849-1.443zm.874 1.312a.15.15 0 0 0-.146 0l-7.2 4a.15.15 0 0 0-.077.13v7.942c0 .054.03.104.077.13l7.2 4a.15.15 0 0 0 .146 0l7.2-4a.15.15 0 0 0 .077-.13V8.03a.15.15 0 0 0-.077-.131z"></Path><Path d="M7.25 12a4.75 4.75 0 1 1 9.5 0a4.75 4.75 0 0 1-9.5 0M12 8.75a3.25 3.25 0 1 0 0 6.5a3.25 3.25 0 0 0 0-6.5"></Path>    </>
  ),
});

BasilSettingsOutline.displayName = "BasilSettingsOutline";
export { BasilSettingsOutline };

const BasilPhoneSolid = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path fill={Palette.gray500} d="M5 9.86a18.47 18.47 0 0 0 9.566 9.292l.68.303a3.5 3.5 0 0 0 4.33-1.247l.889-1.324a1 1 0 0 0-.203-1.335l-3.012-2.43a1 1 0 0 0-1.431.183l-.932 1.257a12.14 12.14 0 0 1-5.51-5.511l1.256-.932a1 1 0 0 0 .183-1.431l-2.43-3.012a1 1 0 0 0-1.335-.203l-1.333.894a3.5 3.5 0 0 0-1.237 4.355z" />    </>
  ),
});

BasilPhoneSolid.displayName = "BasilSettingsOutline";
export { BasilPhoneSolid };


const IcRoundEmail = createIcon({
  viewBox: "0 0 24 24",
  path: (
    <>
      <Path
        strokeWidth="0"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m-.4 4.25l-7.07 4.42c-.32.2-.74.2-1.06 0L4.4 8.25a.85.85 0 1 1 .9-1.44L12 11l6.7-4.19a.85.85 0 1 1 .9 1.44"
      ></Path>
    </>
  ),
});

IcRoundEmail.displayName = "IcRoundEmail";
export { IcRoundEmail };
