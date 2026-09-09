window.GED_CURRENCY={rates:{CAD:1,USD:.73,BRL:3.95,EUR:.63},convert:(cad,to='CAD')=>Math.round(cad*(GED_CURRENCY.rates[to]||1))};
