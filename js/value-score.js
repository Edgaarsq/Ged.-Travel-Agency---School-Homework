window.GED_VALUE={score:(price,rating,amenities=8)=>Math.min(9.9,Math.max(6,(rating*1.15)+(amenities*.12)-(Math.max(0,price-150)/300))).toFixed(1)};
