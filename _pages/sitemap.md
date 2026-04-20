---
layout: archive
title: "Sitemap"
permalink: /sitemap/
author_profile: true
sitemap: false
---

{% include base_path %}

A list of the main pages and academic content on this website.

<h2>Main Pages</h2>
{% assign visible_pages = site.pages | sort: "title" %}
{% for post in visible_pages %}
  {% unless post.url == "/"
    or post.url == "/404.html"
    or post.url == "/sitemap/"
    or post.url contains "/tags/"
    or post.url contains "/categories/"
    or post.sitemap == false %}
    {% include archive-single.html %}
  {% endunless %}
{% endfor %}

{% if site.publications.size > 0 %}
<h2>Research</h2>
{% for post in site.publications reversed %}
  {% unless post.sitemap == false %}
    {% include archive-single.html %}
  {% endunless %}
{% endfor %}
{% endif %}

{% if site.teaching.size > 0 %}
<h2>Teaching</h2>
{% for post in site.teaching reversed %}
  {% unless post.sitemap == false %}
    {% include archive-single.html %}
  {% endunless %}
{% endfor %}
{% endif %}

{% if site.talks.size > 0 %}
<h2>Talks</h2>
{% for post in site.talks reversed %}
  {% unless post.sitemap == false %}
    {% include archive-single.html %}
  {% endunless %}
{% endfor %}
{% endif %}
