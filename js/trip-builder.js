document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('.builder-pro');
  if (!root) return;
  const BASE_FLIGHTS = 680;
  const totalEl = root.querySelector('[data-total]');
  const hotelEl = root.querySelector('[data-builder-hotel]');
  const experienceEl = root.querySelector('[data-builder-experience]');
  const mealEl = root.querySelector('[data-builder-meal]');
  const money = value => `CA$${Number(value).toLocaleString('en-CA')}`;
  function updateTotal(){
    let hotel=0, experience=0, meal=0;
    root.querySelectorAll('.option.selected').forEach(option=>{
      const price=Number(option.dataset.price||0);
      if(option.dataset.group==='hotel') hotel=price;
      if(option.dataset.group==='experience') experience=price;
      if(option.dataset.group==='meal') meal=price;
    });
    if(hotelEl) hotelEl.textContent=money(hotel);
    if(experienceEl) experienceEl.textContent=money(experience);
    if(mealEl) mealEl.textContent=money(meal);
    if(totalEl) totalEl.textContent=money(BASE_FLIGHTS+hotel+experience+meal);
  }
  root.querySelectorAll('.option[data-price]').forEach(option=>option.addEventListener('click',()=>{
    const group=option.dataset.group;
    if(!group)return;
    root.querySelectorAll(`.option[data-group="${group}"]`).forEach(item=>item.classList.remove('selected'));
    option.classList.add('selected');
    updateTotal();
  }));
  root.querySelector('[data-build]')?.addEventListener('click',()=>{
    if(window.GED?.toast) GED.toast('Your demo itinerary has been built.');
    else alert('Your demo itinerary has been built.');
  });
  updateTotal();
});
