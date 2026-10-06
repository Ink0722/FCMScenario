const controls=document.querySelectorAll('[data-size]');
let readingSize=17;
controls.forEach(button=>button.addEventListener('click',()=>{
 readingSize=Math.min(22,Math.max(15,readingSize+Number(button.dataset.size)));
 document.documentElement.style.setProperty('--reading-size',readingSize+'px');
 document.querySelector('#font-size-status').textContent=readingSize+'px';
}));
const links=[...document.querySelectorAll('.reader-nav a')];
const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
const observer=new IntersectionObserver(entries=>{
 for(const entry of entries)if(entry.isIntersecting){links.forEach(a=>a.setAttribute('aria-current',String(a.getAttribute('href')==='#'+entry.target.id)));}
},{rootMargin:'-80px 0px -65% 0px'});
sections.forEach(section=>observer.observe(section));
