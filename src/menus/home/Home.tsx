import { Link } from "react-router-dom";
import cn from "./Home.module.css";

export const Home = () => {
  return (
    <div className={cn.container}>
      <h1 className={cn.title}>[dotcomma]</h1>
      <Link to={"/glitch-city"}>glitch-city</Link>
      <Link to={"/dust"}>dust</Link>
      <Link to={"/readme"}>readme.txt</Link>
    </div>
  );
};
