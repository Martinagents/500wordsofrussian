import json,re,sys
D=json.load(open('src/data/deck.generated.json',encoding='utf-8'));items=D['items'];errs=[]
def ck(x,m):
 if not x: errs.append(m)
ck(len(items)==500,'must have 500 items');ck(sum(i['tier']==1 for i in items)==300,'tier1 300');ck(sum(i['tier']==2 for i in items)==200,'tier2 200');ck(len({i['id'] for i in items})==500,'unique ids');ck(len({i['rank'] for i in items})==500,'unique ranks');ck(min(i['rank'] for i in items)==1 and max(i['rank'] for i in items)==500,'rank range')
pairs=set();cards=set();valid={'production','listening','reading'};sources=set(D['sources'])
for i in items:
 ck(i['english'] and i['russian'],'empty fields');ck(i['enabledCardTypes'],'cards');ck(set(i['enabledCardTypes'])<=valid,'bad card type');ck(not re.fullmatch(r'\d+',i['id']),'array id');ck(set(i['provenance']['sources'])<=sources,'source unresolved');ck('finalScore'in i['provenance'],'score');p=(i['english'],i['russian']);ck(p not in pairs,'duplicate pair');pairs.add(p)
 for t in i['enabledCardTypes']: cid=i['id']+':'+t;ck(cid not in cards,'dup card');cards.add(cid)
for cat in ['greetings','family','food','drink','home','time','movement','Berlin','travel','politeness','clarification','work']:
 ck(any(cat in i['semanticCategories'] or cat in i['tags'] for i in items),f'missing {cat}')
ck(280<=sum(i['type']=='lexeme' for i in items)<=330,'lexeme quota');ck(70<=sum(i['type']=='predicate' or ('frame' in i['tags'] and any(x in i['tags'] for x in ['desire','ability','need'])) for i in items)<=140,'predicate quota');ck(90<=sum(i['type'] in ['frame','phrase'] for i in items)<=180,'frame quota');
if errs: print('\n'.join(errs)); sys.exit(1)
print('curriculum validation passed: 500 items, 300 tier1, 200 tier2,',len(cards),'cards')
