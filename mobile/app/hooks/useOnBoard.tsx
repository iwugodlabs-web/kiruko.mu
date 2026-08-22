

import { useContext } from "react";
import OnBoardContext from "../context/OnBoardContext";

const useOnBoard = () => {
  const context = useContext(OnBoardContext);
  if (!context) {
    throw new Error("OnBoard must be used within a OnBoardProvider");
  }
  return context;
};
export default useOnBoard;
