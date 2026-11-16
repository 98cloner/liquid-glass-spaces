function exceptionalFma(a,b,c){
 if([a,b,c].some(Number.isNaN))return NaN;
 if((!Number.isFinite(a)&&b===0)||(!Number.isFinite(b)&&a===0))return NaN;
 if(!Number.isFinite(a)||!Number.isFinite(b)){
  const productSign=(a<0)!==(b<0)?-Infinity:Infinity;
  return c===-productSign?NaN:productSign;
 }
 return c;
}
const storage = new DataView(new ArrayBuffer(4));
function bits(value) { storage.setFloat32(0, value, true); return storage.getUint32(0, true); }
function value(word) { storage.setUint32(0, word, true); return storage.getFloat32(0, true); }
function split(number) {
  const word = bits(number), exponent = (word >>> 23) & 255;
  return {
    negative: (word >>> 31) !== 0,
    significand: BigInt((word & 0x7fffff) | (exponent === 0 ? 0 : 0x800000)),
    exponent: exponent === 0 ? -149 : exponent - 150,
  };
}
function roundedShift(integer, shift) {
  if (shift <= 0) return integer << BigInt(-shift);
  const quotient = integer >> BigInt(shift);
  const remainder = integer - (quotient << BigInt(shift));
  const halfway = 1n << BigInt(shift - 1);
  return quotient + BigInt(remainder > halfway || (remainder === halfway && (quotient & 1n) === 1n));
}
export function referenceFusedMultiplyAddFloat32(a, b, c) {
  [a, b, c] = [a, b, c].map(Math.fround);
  if (![a, b, c].every(Number.isFinite)) return exceptionalFma(a,b,c);
  const x = split(a), y = split(b), z = split(c);
  const productExponent = x.exponent + y.exponent;
  const commonExponent = Math.min(productExponent, z.exponent);
  const product = x.significand * y.significand * (x.negative !== y.negative ? -1n : 1n);
  const addend = z.significand * (z.negative ? -1n : 1n);
  let exact = (product << BigInt(productExponent - commonExponent))
    + (addend << BigInt(z.exponent - commonExponent));
  if (exact === 0n) return product === 0n && addend === 0n
    && x.negative !== y.negative && z.negative ? -0 : 0;
  const sign = exact < 0n ? 0x80000000 : 0;
  if (exact < 0n) exact = -exact;
  const length = exact.toString(2).length;
  let topExponent = length - 1 + commonExponent;
  if (topExponent < -126) {
    const fraction = roundedShift(exact, -149 - commonExponent);
    return value(sign + Number(fraction));
  }
  let significand = roundedShift(exact, length - 24);
  if (significand === 0x1000000n) { significand >>= 1n; topExponent += 1; }
  if (topExponent > 127) return value(sign + 0x7f800000);
  return value(sign + ((topExponent + 127) * 0x800000) + Number(significand - 0x800000n));
}

const wideStorage=new DataView(new ArrayBuffer(8));
function split64(number){
 wideStorage.setFloat64(0,number,true);const word=wideStorage.getBigUint64(0,true),e=Number((word>>52n)&2047n);
 return {negative:(word>>63n)!==0n,significand:(word&0xfffffffffffffn)|(e===0?0n:0x10000000000000n),exponent:e===0?-1074:e-1075};
}
function value64(word){wideStorage.setBigUint64(0,word,true);return wideStorage.getFloat64(0,true);}
export function referenceFusedMultiplyAddFloat64(a,b,c){
 if(![a,b,c].every(Number.isFinite))return exceptionalFma(a,b,c);
 const x=split64(a),y=split64(b),z=split64(c),pe=x.exponent+y.exponent,ce=Math.min(pe,z.exponent);
 const product=x.significand*y.significand*(x.negative!==y.negative?-1n:1n),addend=z.significand*(z.negative?-1n:1n);
 let exact=(product<<BigInt(pe-ce))+(addend<<BigInt(z.exponent-ce));
 if(exact===0n)return product===0n&&addend===0n&&x.negative!==y.negative&&z.negative?-0:0;
 const sign=exact<0n?0x8000000000000000n:0n;if(exact<0n)exact=-exact;
 const length=exact.toString(2).length;let top=length-1+ce;
 if(top< -1022)return value64(sign+roundedShift(exact,-1074-ce));
 let significand=roundedShift(exact,length-53);
 if(significand===0x20000000000000n){significand>>=1n;top++;}
 if(top>1023)return value64(sign+0x7ff0000000000000n);
 return value64(sign+(BigInt(top+1023)<<52n)+significand-0x10000000000000n);
}

const oddWords=new Uint32Array(2),oddValue=new Float64Array(oddWords.buffer);
const LOW=new Uint8Array(new Uint16Array([1]).buffer)[0]===1?0:1,HIGH=1-LOW;
function roundToOdd(v,error){
 if(error===0)return v;oddValue[0]=v;if(oddWords[LOW]&1)return v;
 const up=(error>0)===(v>0);
 if(up){if(oddWords[LOW]===0xffffffff){oddWords[LOW]=0;oddWords[HIGH]++;}else oddWords[LOW]++;}
 else{if(oddWords[LOW]===0){oddWords[LOW]=0xffffffff;oddWords[HIGH]--;}else oddWords[LOW]--;}
 return oddValue[0];
}
export function fma32(a,b,c){
 a=Math.fround(a);b=Math.fround(b);c=Math.fround(c);
 const p=a*b,v=p+c;
 if(!Number.isFinite(v))return referenceFusedMultiplyAddFloat32(a,b,c);
 if(v===0)return v;
 const bp=v-p,error=(p-(v-bp))+(c-bp);
 return Math.fround(roundToOdd(v,error));
}
const SPLIT=134217729,HI=2**500,LO=2**-500,CMAX=2**1000,TINY=2**-900;
export function fma64(a,b,c){
 const aa=Math.abs(a),ab=Math.abs(b),ac=Math.abs(c);
 if(!(ac<CMAX&&(ac===0||ac>TINY)))return referenceFusedMultiplyAddFloat64(a,b,c);
 if(aa===0||ab===0)return a*b+c;
 if(!(aa<HI&&aa>LO&&ab<HI&&ab>LO))return referenceFusedMultiplyAddFloat64(a,b,c);
 const uh=a*b;
 let t=SPLIT*a;const ah=t-(t-a),al=a-ah;t=SPLIT*b;const bh=t-(t-b),bl=b-bh;
 const ul=((ah*bh-uh)+ah*bl+al*bh)+al*bl;
 const th=c+uh,bv=th-c,tl=(c-(th-bv))+(uh-bv);
 const w=tl+ul;
 if(w===0)return th;
 if(!(Math.abs(w)>TINY))return referenceFusedMultiplyAddFloat64(a,b,c);
 const bw=w-tl,error=(tl-(w-bw))+(ul-bw);
 return th+roundToOdd(w,error);
}
