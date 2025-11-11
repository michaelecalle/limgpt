import React, { useState, useEffect, useRef } from "react";


interface FTScrollingProps {
  children: React.ReactNode;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void; // <- on autorise le parent à écouter le scroll
}

const FTScrolling: React.FC<FTScrollingProps> = ({ children, onScroll }) => {
  const [maxHeight, setMaxHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateMaxHeight = () => {
      if (containerRef.current) {
        const availableHeight =
          window.innerHeight - containerRef.current.getBoundingClientRect().top;
        setMaxHeight(availableHeight);
      }
    };

    window.addEventListener("resize", updateMaxHeight);
    updateMaxHeight();

    return () => window.removeEventListener("resize", updateMaxHeight);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ maxHeight: maxHeight, overflowY: "auto" }}
      onScroll={onScroll} // <- c’est CE conteneur qui scroll
    >
      {children}
    </div>
  );
};


export default FTScrolling;
