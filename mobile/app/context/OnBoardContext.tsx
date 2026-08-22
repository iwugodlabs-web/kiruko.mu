import { createContext } from "react";

 interface OnBoardContextType {
    isBoardingComplete?: boolean;
     changeIsBoardingCompletes: (boarding: boolean) => Promise<void>;
     setUserAccountRole: (userRole: string) => Promise<void>;
     cacheUserRole: string
 }
  
const OnBoardContext = createContext<OnBoardContextType | undefined>(
    undefined
);

export default OnBoardContext;