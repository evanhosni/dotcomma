import { NavLink } from "react-router-dom";

export const PauseMenu = () => {
  return (
    <div id="PauseMenu">
      <NavLink to="/">city</NavLink>
      <NavLink to="dust">dust</NavLink>
      <NavLink to="pharma">pharma</NavLink>
    </div>
  );
};
