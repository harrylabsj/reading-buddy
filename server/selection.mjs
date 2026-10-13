// Return bounded excerpts to the model; full originals remain in the local profile.
export function noteCatalog(notes,limit=30){return notes.slice(0,limit).map(n=>({id:n.id,bookId:n.bookId,title:n.title.slice(0,200),chapter:n.chapter.slice(0,120),date:n.date,type:n.type}));}
export function noteExcerpts(notes,budget=12000){let remaining=budget;return notes.map(n=>{
 const quote=n.quote.slice(0,Math.min(800,remaining));remaining-=quote.length;
 const thought=n.thought.slice(0,Math.min(800,remaining));remaining-=thought.length;
 return {...n,title:n.title.slice(0,200),chapter:n.chapter.slice(0,120),quote,thought,truncated:quote.length<n.quote.length||thought.length<n.thought.length,originalChars:n.quote.length+n.thought.length};
});}
